import { readFile, stat, writeFile } from "node:fs/promises";

import { z } from "zod";

import { VaultError } from "../errors.js";
import { assertEtagMatches, computeEtag } from "../etag.js";
import { listVaultNotes, splitCodeFences } from "../links.js";
import { rebuildFrontmatter, splitFrontmatter, type FrontmatterData } from "./frontmatter.js";
import type { Vault } from "../vault.js";

export const manageTagsSchema = z.object({
  action: z
    .enum(["list", "add", "remove"])
    .describe("list=统计全 vault（或 folder 限定范围）的标签；add=向笔记添加标签（写入 frontmatter tags）；remove=从笔记移除标签（frontmatter 与行内 #tag 一并清除）"),
  path: z
    .string()
    .optional()
    .describe("add/remove 的目标笔记路径（vault 内 POSIX 相对路径，.md 结尾）"),
  tags: z
    .union([z.string(), z.array(z.string()).min(1)])
    .optional()
    .describe("add/remove 的标签，单个或数组；支持嵌套形式 a/b；带 # 前缀会自动去除"),
  folder: z
    .string()
    .optional()
    .describe("list 限定目录（vault 内 POSIX 相对路径）；省略表示整个 vault"),
  if_match: z
    .string()
    .optional()
    .describe("乐观锁：上次 read_note 返回的 etag，与当前内容不符时拒绝修改（add/remove 可用）"),
});

export type TagStat = { tag: string; note_count: number };

export type TagsResult =
  | { scanned: number; tags: TagStat[] }
  | {
      path: string;
      added: string[];
      already_present: string[];
      frontmatter: FrontmatterData | null;
      etag: string;
    }
  | {
      path: string;
      found: boolean;
      removed_from_frontmatter: string[];
      removed_inline: Array<{ tag: string; count: number }>;
      frontmatter: FrontmatterData | null;
      etag: string;
    };

/** 行内标签：# 后接字母/数字/下划线开头，可含 - 与 /（嵌套），不匹配标题/代码栅栏/URL 锚点。 */
const INLINE_TAG = /(?<![\p{L}\p{N}_#/-])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;

/** F08：标签管理。list 覆盖 frontmatter tags 与行内 #tag 两种来源（按笔记去重）。 */
export async function manageTags(
  vault: Vault,
  input: z.input<typeof manageTagsSchema>,
): Promise<TagsResult> {
  if (input.action === "list") {
    return listTags(vault, input.folder);
  }

  if (input.path === undefined) {
    throw new VaultError("INVALID_INPUT", `${input.action} 必须提供 path`);
  }
  const wanted = normalizeTagInput(input.tags);

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
  assertEtagMatches(raw, input.if_match, rel);
  const { data, body } = splitFrontmatter(raw);

  if (input.action === "add") {
    return addTags(abs, rel, raw, data, body, wanted);
  }
  return removeTags(abs, rel, raw, data, body, wanted);
}

async function listTags(vault: Vault, folder: string | undefined): Promise<TagsResult> {
  const folderRel = vault.normalizeRelative(folder ?? "");
  let notes = await listVaultNotes(vault);
  if (folderRel) {
    notes = notes.filter((note) => note.rel.startsWith(`${folderRel}/`));
  }
  const counts = new Map<string, number>();
  for (const note of notes) {
    const content = await readFile(note.abs, "utf8");
    const tags = collectNoteTags(content);
    for (const tag of tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  const tags: TagStat[] = [...counts.entries()]
    .map(([tag, note_count]) => ({ tag, note_count }))
    .sort((a, b) => (b.note_count !== a.note_count ? b.note_count - a.note_count : a.tag.localeCompare(b.tag)));
  return { scanned: notes.length, tags };
}

/** 单篇笔记的标签集合：frontmatter tags + 行内 #tag 去重。 */
function collectNoteTags(content: string): Set<string> {
  const tags = new Set<string>();
  const { data } = splitFrontmatter(content);
  for (const tag of normalizeTagList(data?.tags)) tags.add(tag);
  for (const { text, code } of splitCodeFences(content)) {
    if (code) continue;
    for (const match of text.matchAll(INLINE_TAG)) {
      const tag = match[1];
      if (!/^\d+$/.test(tag)) tags.add(tag); // Obsidian 不允许纯数字标签
    }
  }
  return tags;
}

async function addTags(
  abs: string,
  rel: string,
  raw: string,
  data: FrontmatterData | null,
  body: string,
  wanted: string[],
): Promise<TagsResult> {
  const existing = new Set(collectNoteTags(raw));
  const added: string[] = [];
  const alreadyPresent: string[] = [];
  for (const tag of wanted) {
    (existing.has(tag) ? alreadyPresent : added).push(tag);
  }

  let newRaw = raw;
  let frontmatter = data;
  if (added.length > 0) {
    const next: FrontmatterData = { ...(data ?? {}) };
    next.tags = [...normalizeTagList(next.tags), ...added];
    newRaw = rebuildFrontmatter(next, body);
    frontmatter = next;
    await writeFile(abs, newRaw, "utf8");
  }
  return { path: rel, added, already_present: alreadyPresent, frontmatter, etag: computeEtag(newRaw) };
}

async function removeTags(
  abs: string,
  rel: string,
  raw: string,
  data: FrontmatterData | null,
  body: string,
  wanted: string[],
): Promise<TagsResult> {
  const removedFromFrontmatter: string[] = [];
  const removedInline: Array<{ tag: string; count: number }> = [];
  let working = body;
  let frontmatter = data;

  if (data?.tags !== undefined) {
    const list = normalizeTagList(data.tags);
    const kept = list.filter((tag) => !wanted.includes(tag));
    for (const tag of list) {
      if (wanted.includes(tag)) removedFromFrontmatter.push(tag);
    }
    const next: FrontmatterData = { ...data };
    if (kept.length === 0) delete next.tags;
    else next.tags = kept;
    frontmatter = next;
  }

  for (const tag of wanted) {
    const { text: cleaned, count } = removeInlineTag(working, tag);
    if (count > 0) {
      working = cleaned;
      removedInline.push({ tag, count });
    }
  }

  const nextData = frontmatter;
  const emptied =
    nextData !== null && nextData !== undefined && Object.keys(nextData).length === 0;
  const newRaw =
    nextData === null || nextData === undefined || emptied
      ? working
      : rebuildFrontmatter(nextData, working);
  const found = removedFromFrontmatter.length > 0 || removedInline.length > 0;
  if (newRaw !== raw) {
    await writeFile(abs, newRaw, "utf8");
  }
  return {
    path: rel,
    found,
    removed_from_frontmatter: removedFromFrontmatter,
    removed_inline: removedInline,
    frontmatter: nextData === null || nextData === undefined || emptied ? null : nextData,
    etag: computeEtag(newRaw),
  };
}

/** 从非代码片段中移除该标签的行内出现（精确整词，不影响嵌套子标签）。 */
function removeInlineTag(content: string, tag: string): { text: string; count: number } {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_#/-])#${escaped}(?![\\p{L}\\p{N}_/-])`,
    "gu",
  );
  let count = 0;
  const text = splitCodeFences(content)
    .map(({ text: segment, code }) => {
      if (code) return segment;
      return segment.replace(pattern, () => {
        count += 1;
        return "";
      });
    })
    .join("");
  return { text, count };
}

function normalizeTagInput(tags: string | string[] | undefined): string[] {
  if (tags === undefined) {
    throw new VaultError("INVALID_INPUT", "add/remove 必须提供 tags");
  }
  const list = Array.isArray(tags) ? tags : [tags];
  const normalized: string[] = [];
  for (const item of list) {
    const tag = item.trim().replace(/^#+/, "");
    if (tag === "" || /\s/.test(tag) || /^\d+$/.test(tag)) {
      throw new VaultError("INVALID_INPUT", `非法标签名: ${JSON.stringify(item)}`);
    }
    if (!normalized.includes(tag)) normalized.push(tag);
  }
  return normalized;
}

/** frontmatter tags 字段宽容归一化：字符串或字符串数组；其他类型视为空。 */
function normalizeTagList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

export const manageTagsTool = {
  name: "manage_tags",
  description:
    "管理 Obsidian 标签。list 统计全 vault（可 folder 限定）的标签及笔记数，来源覆盖 frontmatter tags 与行内 #tag（按笔记去重）；add 向笔记 frontmatter tags 写入标签（已存在于 frontmatter 或行内时报告 already_present）；remove 从 frontmatter 与正文行内一并移除（精确整词，不影响嵌套子标签与代码块）。add/remove 支持 if_match 乐观锁。",
  schema: manageTagsSchema,
  handler: manageTags,
} as const;
