import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { VaultError } from "../errors.js";
import { collectNoteTags } from "./tags.js";
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
  sort: z
    .enum(["path", "modified", "matches"])
    .optional()
    .describe("结果排序：path=按文件路径（默认）；modified=按修改时间（新在前）；matches=按文件命中数（多在前）"),
  tag: z
    .string()
    .optional()
    .describe("只搜索包含该标签的笔记（frontmatter tags 或行内 #tag；支持嵌套形式 a/b）"),
  cursor: z
    .string()
    .optional()
    .describe("分页游标：传上一次结果返回的 next_cursor 获取下一页"),
  max_results: z
    .number()
    .optional()
    .describe("每页最多返回的命中行数；默认 100，上限 1000"),
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

export interface SearchResult {
  hits: SearchHit[];
  /** 还有更多结果时给出下一页游标；翻完为 null */
  next_cursor: string | null;
}

interface ScanEntry extends SearchHit {
  mtimeMs: number;
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const DEFAULT_PAGE_SIZE = 100;
const HARD_MAX_RESULTS = 1000;

/** F03/F10：全文搜索。行级命中 + 文件级 match_count；游标分页、排序、标签过滤；无匹配返回空页（E09）。 */
export async function searchNotes(
  vault: Vault,
  input: z.input<typeof searchNotesSchema>,
): Promise<SearchResult> {
  const query = input.query;
  if (!query) {
    throw new VaultError("INVALID_INPUT", "搜索关键词不能为空");
  }
  const caseSensitive = input.case_sensitive ?? false;
  const sort = input.sort ?? "path";
  const pageSize = clampPageSize(input.max_results);
  const tagFilter = input.tag !== undefined ? normalizeTagFilter(input.tag) : null;

  const folderRel = vault.normalizeRelative(input.folder ?? "");
  const folderAbs = vault.resolvePath(folderRel);
  await assertDirectory(folderAbs, folderRel);

  const candidates = await collectMarkdownFiles(folderAbs, folderRel);
  const entries: ScanEntry[] = [];
  for (const candidate of candidates) {
    const fileStat = await statSafe(candidate.abs);
    if (!fileStat) continue;
    const content = await readFileSafe(candidate.abs);
    if (content === null) continue;
    if (tagFilter && !collectNoteTags(content).has(tagFilter)) continue;

    const lines = content.split(/\r\n|\r|\n/);
    const fileHits: Omit<ScanEntry, "mtimeMs">[] = [];
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
    for (const hit of fileHits) hit.match_count = fileTotal;
    for (const hit of fileHits) entries.push({ ...hit, mtimeMs: Number(fileStat.mtimeMs) });
  }

  entries.sort((a, b) => compareEntries(a, b, sort));

  const offset = input.cursor !== undefined ? decodeCursor(input.cursor) : 0;
  // mtimeMs 仅供排序，不暴露给调用方
  const page = entries
    .slice(offset, offset + pageSize)
    .map(({ path, line_number, line_text, match_count }) => ({ path, line_number, line_text, match_count }));
  const nextCursor = offset + page.length < entries.length ? encodeCursor(offset + page.length) : null;
  return { hits: page, next_cursor: nextCursor };
}

function compareEntries(a: ScanEntry, b: ScanEntry, sort: "path" | "modified" | "matches"): number {
  if (sort === "modified" && a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs;
  if (sort === "matches" && a.match_count !== b.match_count) return b.match_count - a.match_count;
  const byPath = collator.compare(a.path, b.path);
  if (byPath !== 0) return byPath;
  return a.line_number - b.line_number;
}

function clampPageSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(value) || value < 1) {
    throw new VaultError("INVALID_INPUT", `max_results 必须是正整数: ${value}`);
  }
  return Math.min(value, HARD_MAX_RESULTS);
}

function normalizeTagFilter(tag: string): string {
  const normalized = tag.trim().replace(/^#/, "");
  if (normalized === "" || /\s/.test(normalized)) {
    throw new VaultError("INVALID_INPUT", `非法标签过滤条件: ${JSON.stringify(tag)}`);
  }
  return normalized;
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new VaultError("INVALID_INPUT", "非法分页游标；请使用上一次结果返回的 next_cursor");
  }
  const offset =
    typeof parsed === "object" && parsed !== null && "offset" in parsed
      ? (parsed as { offset: unknown }).offset
      : undefined;
  if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) {
    throw new VaultError("INVALID_INPUT", "非法分页游标；请使用上一次结果返回的 next_cursor");
  }
  return offset;
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

async function statSafe(abs: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(abs);
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
    "在 Obsidian vault 中按关键词全文搜索笔记（纯文本子串匹配，非正则），返回命中文件、行号、行内容与该文件命中总次数。支持 sort 排序（path/modified/matches）、tag 标签过滤（frontmatter 或行内标签）、cursor 游标分页（结果超过 max_results 时用返回的 next_cursor 翻页）。点开头的隐藏目录（.obsidian、.trash 等）与非 Markdown 文件不在搜索范围。",
  schema: searchNotesSchema,
  handler: searchNotes,
} as const;
