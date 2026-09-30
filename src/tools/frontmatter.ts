import { readFile, stat, writeFile } from "node:fs/promises";

import { dump, load } from "js-yaml";
import { z } from "zod";

import { VaultError } from "../errors.js";
import { assertEtagMatches, computeEtag } from "../etag.js";
import type { Vault } from "../vault.js";

const FM_OPEN = /^---[ \t]*\r?\n/;

export const manageFrontmatterSchema = z.object({
  path: z
    .string()
    .describe("笔记路径（vault 内 POSIX 风格相对路径，需以 .md 结尾）"),
  action: z
    .enum(["get", "set", "delete"])
    .describe("get=读取字段；set=写入字段（无 frontmatter 时自动创建）；delete=删除字段（删到空时整块移除）"),
  key: z
    .string()
    .optional()
    .describe("frontmatter 字段名；get 省略 key 时返回整个 frontmatter 对象"),
  value: z
    .unknown()
    .optional()
    .describe("set 时写入的值：字符串/数字/布尔/null/数组/嵌套对象均可（YAML 表达）"),
  if_match: z
    .string()
    .optional()
    .describe("乐观锁：上次 read_note 返回的 etag，与当前内容不符时拒绝修改（set/delete 可用）"),
});

export type FrontmatterData = Record<string, unknown>;

export type FrontmatterResult =
  | { path: string; frontmatter: FrontmatterData | null }
  | { path: string; frontmatter: FrontmatterData | null; found: boolean; value: unknown }
  | { path: string; frontmatter: FrontmatterData | null; etag: string };

/**
 * F07：frontmatter 字段管理。切分定界符自己做（保证正文字节级保真，E12 的"文件不变"约束），
 * YAML 解析与序列化两端同用 js-yaml（D006/D007）。
 */
export async function manageFrontmatter(
  vault: Vault,
  input: z.input<typeof manageFrontmatterSchema>,
): Promise<FrontmatterResult> {
  const abs = vault.resolveMarkdownPath(input.path);
  const rel = vault.normalizeRelative(input.path);

  let statResult;
  try {
    statResult = await stat(abs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new VaultError("NOT_FOUND", `笔记不存在: ${rel}`);
    }
    throw error;
  }
  if (!statResult.isFile()) {
    throw new VaultError("NOT_A_FILE", `目标不是文件: ${rel}`);
  }

  const raw = await readFile(abs, "utf8");

  if (input.action === "get") {
    const { data } = splitFrontmatter(raw);
    if (input.key === undefined) {
      return { path: rel, frontmatter: data };
    }
    if (data === null || !(input.key in data)) {
      return { path: rel, frontmatter: data, found: false, value: null };
    }
    return { path: rel, frontmatter: data, found: true, value: data[input.key] };
  }

  if (input.key === undefined || input.key === "") {
    throw new VaultError("INVALID_INPUT", `${input.action} 必须提供非空 key`);
  }
  assertEtagMatches(raw, input.if_match, rel);

  if (input.action === "set") {
    if (input.value === undefined) {
      throw new VaultError("INVALID_INPUT", "set 必须提供 value（如需清空请用 delete）");
    }
    const { data, body } = splitFrontmatter(raw);
    const next: FrontmatterData = { ...(data ?? {}) };
    next[input.key] = input.value;
    const newRaw = `---\n${dump(next, { lineWidth: -1 })}---\n${body}`;
    await writeFile(abs, newRaw, "utf8");
    return { path: rel, frontmatter: next, etag: computeEtag(newRaw) };
  }

  const { data, body } = splitFrontmatter(raw);
  if (data === null || !(input.key in data)) {
    throw new VaultError("KEY_NOT_FOUND", `frontmatter 字段不存在: ${input.key}`);
  }
  const next: FrontmatterData = { ...data };
  delete next[input.key];
  const emptied = Object.keys(next).length === 0;
  // 删到空时整块移除 frontmatter，避免留下空的 ---/--- 对
  const newRaw = emptied ? body : `---\n${dump(next, { lineWidth: -1 })}---\n${body}`;
  await writeFile(abs, newRaw, "utf8");
  return { path: rel, frontmatter: emptied ? null : next, etag: computeEtag(newRaw) };
}

/**
 * 切分 frontmatter 与正文。规则：
 * - 文件以 --- 行开头且存在闭合 --- 行才算 frontmatter（Obsidian 语义），否则整个文件是正文；
 * - YAML 非法或不是键值映射 → FRONTMATTER_INVALID（E12），调用方不会写盘；
 * - body 为闭合定界符之后的原文（含其前导空行），保证 set/delete 后正文逐字节不变。
 */
export function splitFrontmatter(raw: string): { data: FrontmatterData | null; body: string } {
  if (!FM_OPEN.test(raw)) return { data: null, body: raw };
  const rest = raw.slice(4);
  // 空白 frontmatter：---\n---\nbody
  const emptyClose = /^---[ \t]*\r?\n/.exec(rest);
  if (emptyClose) return { data: {}, body: rest.slice(emptyClose[0].length) };
  const close = /\n---[ \t]*(?:\r?\n|$)/.exec(rest);
  if (!close) return { data: null, body: raw }; // 无闭合定界符 → 不是 frontmatter
  const yamlText = rest.slice(0, close.index);
  const body = rest.slice(close.index + close[0].length);
  let parsed: unknown;
  try {
    parsed = load(yamlText);
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new VaultError("FRONTMATTER_INVALID", `frontmatter YAML 解析失败: ${reason.slice(0, 120)}`);
  }
  if (parsed === null || parsed === undefined) return { data: {}, body };
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new VaultError("FRONTMATTER_INVALID", "frontmatter 必须是键值映射（YAML 对象）");
  }
  return { data: parsed as FrontmatterData, body };
}

/** 用新的 frontmatter 数据与原正文重组文件内容（data 必须非空，调用方自行处理删空场景）。 */
export function rebuildFrontmatter(data: FrontmatterData, body: string): string {
  return `---\n${dump(data, { lineWidth: -1 })}---\n${body}`;
}

export const manageFrontmatterTool = {
  name: "manage_frontmatter",
  description:
    "管理 Obsidian 笔记的 YAML frontmatter：get 读取整个 frontmatter 或指定字段（key 省略返回全部）；set 写入字段（支持字符串/数字/布尔/null/数组/嵌套对象，无 frontmatter 时自动创建）；delete 删除字段（删到空时整块移除 frontmatter）。YAML 损坏时拒绝操作且文件不变。set/delete 支持 if_match 乐观锁。",
  schema: manageFrontmatterSchema,
  handler: manageFrontmatter,
} as const;
