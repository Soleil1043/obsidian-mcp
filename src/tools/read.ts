import { readFile, stat } from "node:fs/promises";

import { z } from "zod";

import { VaultError } from "../errors.js";
import { computeEtag } from "../etag.js";
import type { Vault } from "../vault.js";

export const readNoteSchema = z.object({
  path: z
    .string()
    .describe("要读取的笔记路径（vault 内 POSIX 风格相对路径，需以 .md 结尾）"),
});

export interface NoteContent {
  /** vault 内相对路径（归一化后） */
  path: string;
  /** 文件全文，UTF-8 原文，含 frontmatter，不做任何改写 */
  content: string;
  size_bytes: number;
  /** ISO 8601 修改时间 */
  modified_at: string;
  /** 内容 SHA-256，配合写工具的 if_match 做乐观锁（F11） */
  etag: string;
}

/** F02：读取笔记全文。E02 不存在时报 NOT_FOUND，不创建文件；E06 非 .md 拒绝。 */
export async function readNote(
  vault: Vault,
  input: z.infer<typeof readNoteSchema>,
): Promise<NoteContent> {
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

  const content = await readFile(abs, "utf8");
  return {
    path: rel,
    content,
    size_bytes: statResult.size,
    modified_at: statResult.mtime.toISOString(),
    etag: computeEtag(content),
  };
}

export const readNoteTool = {
  name: "read_note",
  description:
    "读取 Obsidian vault 中一篇笔记的完整 Markdown 内容（UTF-8 原文，含 frontmatter），并返回文件大小与修改时间。路径为 vault 内相对路径，必须以 .md 结尾。",
  schema: readNoteSchema,
  handler: readNote,
} as const;
