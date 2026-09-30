import { readFile, stat, writeFile } from "node:fs/promises";

import { z } from "zod";

import { VaultError } from "../errors.js";
import { assertEtagMatches, computeEtag } from "../etag.js";
import type { Vault } from "../vault.js";

export const editNoteSchema = z.object({
  path: z
    .string()
    .describe("要编辑的笔记路径（vault 内 POSIX 风格相对路径，需以 .md 结尾）"),
  mode: z
    .enum(["overwrite", "append", "replace"])
    .describe("overwrite=整体覆盖；append=在文末追加；replace=把 old_string 精准替换为 content"),
  content: z
    .string()
    .describe("overwrite/append 模式：要写入的新内容；replace 模式：替换后的文本（可为空串实现删除片段）"),
  old_string: z
    .string()
    .optional()
    .describe("replace 模式必填：要被替换的原文片段；需在文中唯一，否则须传 replace_all=true"),
  replace_all: z
    .boolean()
    .optional()
    .describe("replace 模式：替换全部匹配；默认 false（片段必须唯一才执行）"),
  if_match: z
    .string()
    .optional()
    .describe("乐观锁：传入上次 read_note 返回的 etag，与当前内容不符时拒绝写入（推荐多客户端场景使用）"),
});

export interface EditedNote {
  /** vault 内相对路径（归一化后） */
  path: string;
  mode: "overwrite" | "append" | "replace";
  size_bytes: number;
  /** 编辑后内容的 SHA-256，可链式用于下一次编辑的 if_match */
  etag: string;
}

/** F05：编辑笔记。replace 在未找到/多处匹配时报错且文件不变（E04）；替换为字面量（不解析 $ 模式）。 */
export async function editNote(
  vault: Vault,
  input: z.input<typeof editNoteSchema>,
): Promise<EditedNote> {
  const abs = vault.resolveMarkdownPath(input.path);
  const rel = vault.normalizeRelative(input.path);
  const replaceAll = input.replace_all ?? false;

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

  const current = await readFile(abs, "utf8");
  assertEtagMatches(current, input.if_match, rel);
  let next: string;
  if (input.mode === "overwrite") {
    next = input.content;
  } else if (input.mode === "append") {
    next = current + input.content;
  } else {
    const old = input.old_string;
    if (!old) {
      throw new VaultError("INVALID_INPUT", "replace 模式必须提供非空 old_string");
    }
    const occurrences = countOccurrences(current, old);
    if (occurrences === 0) {
      throw new VaultError(
        "REPLACE_NOT_FOUND",
        `未找到待替换片段: ${truncate(old)}（请先用 read_note 核对原文）`,
      );
    }
    if (occurrences > 1 && !replaceAll) {
      throw new VaultError(
        "REPLACE_AMBIGUOUS",
        `待替换片段 ${truncate(old)} 在文中出现 ${occurrences} 处；请加长片段使其唯一，或传 replace_all=true`,
      );
    }
    // split/join 做字面替换，避开 String.replace 对 "$&" 等替换模式的特殊解析
    next = current.split(old).join(input.content);
  }

  if (next !== current) {
    await writeFile(abs, next, "utf8");
  }
  return { path: rel, mode: input.mode, size_bytes: Buffer.byteLength(next, "utf8"), etag: computeEtag(next) };
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let cursor = 0;
  while ((cursor = haystack.indexOf(needle, cursor)) !== -1) {
    count += 1;
    cursor += needle.length;
  }
  return count;
}

function truncate(text: string, max = 40): string {
  const shortened = text.length > max ? `${text.slice(0, max)}…` : text;
  return JSON.stringify(shortened);
}

export const editNoteTool = {
  name: "edit_note",
  description:
    "编辑 Obsidian vault 中已有笔记，三种模式：overwrite 整体覆盖、append 末尾追加、replace 把 old_string 精准替换为 content（字面替换，非正则）。replace 要求片段唯一，多处匹配时报错（可改传 replace_all=true）；未找到时报错且文件不变。推荐先 read_note 拿到原文再 replace。",
  schema: editNoteSchema,
  handler: editNote,
} as const;
