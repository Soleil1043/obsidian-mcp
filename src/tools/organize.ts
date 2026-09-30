import { mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { VaultError } from "../errors.js";
import type { Vault } from "../vault.js";

export const moveNoteSchema = z.object({
  from: z
    .string()
    .describe("源笔记路径（vault 内 POSIX 风格相对路径，需以 .md 结尾）"),
  to: z
    .string()
    .describe("目标路径（vault 内 POSIX 风格相对路径，需以 .md 结尾）；同目录即重命名，跨目录即移动；目标父目录不存在时自动创建"),
});

export interface MovedNote {
  from: string;
  to: string;
}

/** F06：重命名/移动笔记。E08 目标已存在时报 ALREADY_EXISTS，源文件保持原位。 */
export async function moveNote(
  vault: Vault,
  input: z.input<typeof moveNoteSchema>,
): Promise<MovedNote> {
  const fromAbs = vault.resolveMarkdownPath(input.from);
  const fromRel = vault.normalizeRelative(input.from);
  const toAbs = vault.resolveMarkdownPath(input.to);
  const toRel = vault.normalizeRelative(input.to);

  if (fromRel === toRel) {
    throw new VaultError("INVALID_INPUT", "源路径与目标路径相同");
  }

  let fromStat;
  try {
    fromStat = await stat(fromAbs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new VaultError("NOT_FOUND", `源笔记不存在: ${fromRel}`);
    }
    throw error;
  }
  if (!fromStat.isFile()) {
    throw new VaultError("NOT_A_FILE", `源不是文件: ${fromRel}`);
  }

  let toStat = null;
  try {
    toStat = await stat(toAbs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (toStat) {
    throw new VaultError(
      "ALREADY_EXISTS",
      `目标已存在: ${toRel}（move 不覆盖目标；请换目标路径或先处理已有文件）`,
    );
  }

  await mkdir(path.dirname(toAbs), { recursive: true });
  await rename(fromAbs, toAbs);
  return { from: fromRel, to: toRel };
}

export const moveNoteTool = {
  name: "move_note",
  description:
    "移动或重命名 Obsidian vault 中的笔记（也可用于整理目录结构：配合 list_notes 浏览后移动）。目标已存在时报错且不覆盖；目标父目录不存在时自动创建。",
  schema: moveNoteSchema,
  handler: moveNote,
} as const;
