import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { VaultError } from "../errors.js";
import type { Vault } from "../vault.js";

export const createNoteSchema = z.object({
  path: z
    .string()
    .describe("新笔记路径（vault 内 POSIX 风格相对路径，需以 .md 结尾；父目录不存在时自动创建）"),
  content: z.string().optional().describe("初始 Markdown 内容；默认为空笔记"),
  overwrite: z.boolean().optional().describe("目标已存在时是否覆盖；默认 false（报错）"),
});

export interface CreatedNote {
  /** vault 内相对路径（归一化后） */
  path: string;
  size_bytes: number;
}

/** F04：创建笔记。父目录自动创建；E03 已存在时报 ALREADY_EXISTS，显式 overwrite=true 才覆盖。 */
export async function createNote(
  vault: Vault,
  input: z.input<typeof createNoteSchema>,
): Promise<CreatedNote> {
  const abs = vault.resolveMarkdownPath(input.path);
  const rel = vault.normalizeRelative(input.path);
  const content = input.content ?? "";
  const overwrite = input.overwrite ?? false;

  let existing = null;
  try {
    existing = await stat(abs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing?.isDirectory()) {
    throw new VaultError("NOT_A_FILE", `目标路径是目录: ${rel}`);
  }
  if (existing && !overwrite) {
    throw new VaultError("ALREADY_EXISTS", `笔记已存在: ${rel}（如需覆盖请传 overwrite=true）`);
  }

  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
  return { path: rel, size_bytes: Buffer.byteLength(content, "utf8") };
}

export const createNoteTool = {
  name: "create_note",
  description:
    "在 Obsidian vault 中创建新笔记并写入初始内容。路径为 vault 内相对路径（以 .md 结尾），不存在的父目录会自动创建；目标已存在时默认报错，仅当显式传 overwrite=true 才覆盖。",
  schema: createNoteSchema,
  handler: createNote,
} as const;
