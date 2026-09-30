import { access, mkdir, rename, rm, stat } from "node:fs/promises";
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

export const deleteNoteSchema = z.object({
  path: z
    .string()
    .describe("要删除的笔记路径（vault 内 POSIX 风格相对路径，需以 .md 结尾）"),
  permanent: z
    .boolean()
    .optional()
    .describe("true=永久删除（不可恢复）；默认 false=移入 vault 根 .trash/（Obsidian 可在其界面恢复）"),
});

export interface DeletedNote {
  path: string;
  permanent: boolean;
  /** permanent=false 时，文件在 .trash/ 内的新相对路径 */
  trash_path?: string;
}

/** F06：删除笔记。默认移入 vault 根 .trash/（E07，同名冲突自动加时间戳后缀）；permanent=true 才永久删除。 */
export async function deleteNote(
  vault: Vault,
  input: z.input<typeof deleteNoteSchema>,
): Promise<DeletedNote> {
  const abs = vault.resolveMarkdownPath(input.path);
  const rel = vault.normalizeRelative(input.path);
  const permanent = input.permanent ?? false;

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

  if (permanent) {
    await rm(abs);
    return { path: rel, permanent: true };
  }

  if (rel.startsWith(".trash/")) {
    throw new VaultError(
      "INVALID_INPUT",
      `${rel} 已在 .trash/ 中；如需彻底清除请传 permanent=true`,
    );
  }

  const trashAbs = path.join(vault.root, ".trash");
  await mkdir(trashAbs, { recursive: true });
  const trashFileAbs = await uniqueTrashPath(trashAbs, path.basename(abs));
  await rename(abs, trashFileAbs);
  return { path: rel, permanent: false, trash_path: `.trash/${path.basename(trashFileAbs)}` };
}

/** .trash 内唯一文件名：同名时用时间戳后缀（同毫秒再冲突则加序号）。 */
async function uniqueTrashPath(trashAbs: string, originalName: string): Promise<string> {
  const ext = path.extname(originalName);
  const base = ext ? originalName.slice(0, -ext.length) : originalName;

  const exists = async (candidate: string): Promise<boolean> => {
    try {
      await access(candidate);
      return true;
    } catch {
      return false;
    }
  };

  const direct = path.join(trashAbs, originalName);
  if (!(await exists(direct))) return direct;

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\./g, "")
    .replace(/Z$/, "");
  let candidate = path.join(trashAbs, `${base}.${stamp}${ext}`);
  for (let suffix = 2; (await exists(candidate)); suffix += 1) {
    candidate = path.join(trashAbs, `${base}.${stamp}-${suffix}${ext}`);
  }
  return candidate;
}

export const deleteNoteTool = {
  name: "delete_note",
  description:
    "删除 Obsidian vault 中的笔记。默认移入 vault 根 .trash/（Obsidian 原生可恢复位置，同名自动加时间戳后缀），仅在明确要求时传 permanent=true 永久删除。",
  schema: deleteNoteSchema,
  handler: deleteNote,
} as const;
