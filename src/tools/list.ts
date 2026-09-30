import { readdir, stat } from "node:fs/promises";

import { z } from "zod";

import { VaultError } from "../errors.js";
import type { Vault } from "../vault.js";

export const listNotesSchema = z.object({
  folder: z
    .string()
    .optional()
    .describe("要列出的目录（vault 内 POSIX 风格相对路径）；省略或留空表示 vault 根目录"),
});

export interface VaultEntry {
  /** vault 内相对路径（POSIX 风格） */
  path: string;
  /** 文件/文件夹名 */
  name: string;
  type: "note" | "folder";
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** F01：列出目录下的笔记（.md）与子文件夹，跳过点开头的隐藏条目（.obsidian、.trash 等）。 */
export async function listNotes(
  vault: Vault,
  input: z.infer<typeof listNotesSchema>,
): Promise<VaultEntry[]> {
  const folderRel = vault.normalizeRelative(input.folder ?? "");
  const folderAbs = vault.resolvePath(folderRel);

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

  const dirents = await readdir(folderAbs, { withFileTypes: true });
  const entries: VaultEntry[] = [];
  for (const dirent of dirents) {
    if (dirent.name.startsWith(".")) continue;
    if (dirent.isDirectory()) {
      entries.push({
        path: joinRelative(folderRel, dirent.name),
        name: dirent.name,
        type: "folder",
      });
    } else if (dirent.name.toLowerCase().endsWith(".md")) {
      entries.push({
        path: joinRelative(folderRel, dirent.name),
        name: dirent.name,
        type: "note",
      });
    }
    // 其他非 Markdown 文件（附件等）不在 F01 范围内，静默跳过
  }
  entries.sort((a, b) =>
    a.type !== b.type
      ? a.type === "folder"
        ? -1
        : 1
      : collator.compare(a.name, b.name),
  );
  return entries;
}

function joinRelative(folderRel: string, name: string): string {
  return folderRel ? `${folderRel}/${name}` : name;
}

export const listNotesTool = {
  name: "list_notes",
  description:
    "列出 Obsidian vault 指定目录下的笔记（.md）与子文件夹。跳过点开头的隐藏条目（如 .obsidian、.trash）与非 Markdown 文件。目录按名称排序且排在笔记前。",
  schema: listNotesSchema,
  handler: listNotes,
} as const;
