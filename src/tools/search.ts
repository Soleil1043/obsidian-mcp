import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { VaultError } from "../errors.js";
import type { Vault } from "../vault.js";

export const searchNotesSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("搜索关键词：纯文本子串匹配（非正则），例如笔记标题、待办字样"),
  folder: z
    .string()
    .optional()
    .describe("限定搜索的目录（vault 内 POSIX 风格相对路径）；省略表示整个 vault"),
  case_sensitive: z
    .boolean()
    .optional()
    .describe("是否区分大小写；默认 false"),
  max_results: z
    .number()
    .optional()
    .describe("最多返回的命中行数；默认 100，上限 1000"),
});

export interface SearchHit {
  /** vault 内相对路径（POSIX 风格） */
  path: string;
  /** 命中行号（1 起） */
  line_number: number;
  /** 命中行原文 */
  line_text: string;
  /** 该文件内关键词出现总次数 */
  match_count: number;
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const DEFAULT_MAX_RESULTS = 100;
const HARD_MAX_RESULTS = 1000;

/** F03：全文搜索。按行返回命中，文件内汇总 match_count；无匹配返回空列表（E09）。 */
export async function searchNotes(
  vault: Vault,
  input: z.input<typeof searchNotesSchema>,
): Promise<SearchHit[]> {
  const query = input.query;
  if (!query) {
    throw new VaultError("INVALID_INPUT", "搜索关键词不能为空");
  }
  const caseSensitive = input.case_sensitive ?? false;
  const maxResults = clampMaxResults(input.max_results);

  const folderRel = vault.normalizeRelative(input.folder ?? "");
  const folderAbs = vault.resolvePath(folderRel);
  await assertDirectory(folderAbs, folderRel);

  const candidates = await collectMarkdownFiles(folderAbs, folderRel);
  candidates.sort((a, b) => collator.compare(a.rel, b.rel));

  const hits: SearchHit[] = [];
  for (const candidate of candidates) {
    const content = await readFileSafe(candidate.abs);
    if (content === null) continue;
    const lines = content.split(/\r\n|\r|\n/);
    const fileHits: SearchHit[] = [];
    let fileTotal = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const count = countOccurrences(lines[index], query, caseSensitive);
      if (count === 0) continue;
      fileTotal += count;
      fileHits.push({
        path: candidate.rel,
        line_number: index + 1,
        line_text: lines[index],
        match_count: 0,
      });
    }
    if (fileHits.length === 0) continue;
    for (const hit of fileHits) hit.match_count = fileTotal;
    for (const hit of fileHits) {
      if (hits.length >= maxResults) break;
      hits.push(hit);
    }
    if (hits.length >= maxResults) break;
  }
  return hits;
}

function clampMaxResults(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_RESULTS;
  if (!Number.isInteger(value) || value < 1) {
    throw new VaultError("INVALID_INPUT", `max_results 必须是正整数: ${value}`);
  }
  return Math.min(value, HARD_MAX_RESULTS);
}

async function assertDirectory(folderAbs: string, folderRel: string): Promise<void> {
  let statResult;
  try {
    statResult = await stat(folderAbs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new VaultError("NOT_FOUND", `目录不存在: ${folderRel || "(vault 根)"}`);
    }
    throw error;
  }
  if (!statResult.isDirectory()) {
    throw new VaultError("NOT_A_DIRECTORY", `不是目录: ${folderRel}`);
  }
}

interface MarkdownFile {
  abs: string;
  /** vault 内相对路径（POSIX 风格） */
  rel: string;
}

/** 递归收集目录下所有 .md 文件，跳过点开头的隐藏目录（.obsidian、.trash 等）与非 Markdown 文件。 */
async function collectMarkdownFiles(
  folderAbs: string,
  folderRel: string,
): Promise<MarkdownFile[]> {
  const dirents = await readdir(folderAbs, { recursive: true, withFileTypes: true });
  const files: MarkdownFile[] = [];
  for (const dirent of dirents) {
    if (!dirent.isFile()) continue;
    const abs = path.join(dirent.parentPath, dirent.name);
    const relFromFolder = path.relative(folderAbs, abs).split(path.sep).join("/");
    const segments = relFromFolder.split("/");
    if (segments.some((segment) => segment.startsWith("."))) continue;
    if (!dirent.name.toLowerCase().endsWith(".md")) continue;
    files.push({
      abs,
      rel: folderRel ? `${folderRel}/${relFromFolder}` : relFromFolder,
    });
  }
  return files;
}

/** 读取文件内容；文件在遍历期间消失（ENOENT）时跳过。 */
async function readFileSafe(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function countOccurrences(line: string, query: string, caseSensitive: boolean): number {
  if (query.length === 0) return 0;
  const haystack = caseSensitive ? line : line.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  let count = 0;
  let cursor = 0;
  while ((cursor = haystack.indexOf(needle, cursor)) !== -1) {
    count += 1;
    cursor += needle.length;
  }
  return count;
}

export const searchNotesTool = {
  name: "search_notes",
  description:
    "在 Obsidian vault 中按关键词全文搜索笔记（纯文本子串匹配，非正则），返回命中文件、行号、行内容与该文件命中总次数。可用 folder 限定目录、case_sensitive 区分大小写；结果按 max_results 截断（默认 100）。点开头的隐藏目录（.obsidian、.trash 等）与非 Markdown 文件不在搜索范围。",
  schema: searchNotesSchema,
  handler: searchNotes,
} as const;
