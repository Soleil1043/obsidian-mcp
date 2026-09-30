import { access, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { listVaultNotes, updateLinksAfterMove } from "../links.js";
import { VaultError } from "../errors.js";
import { assertEtagMatches, computeEtag } from "../etag.js";
import type { Vault } from "../vault.js";

export const moveNoteSchema = z.object({
  from: z
    .string()
    .describe("源笔记路径（vault 内 POSIX 风格相对路径，需以 .md 结尾）"),
  to: z
    .string()
    .describe("目标路径（vault 内 POSIX 风格相对路径，需以 .md 结尾）；同目录即重命名，跨目录即移动；目标父目录不存在时自动创建"),
  if_match: z
    .string()
    .optional()
    .describe("乐观锁：传入上次 read_note 返回的 etag，与源笔记当前内容不符时拒绝移动"),
});

export interface MovedNote {
  from: string;
  to: string;
  /** 移动后内容的 SHA-256（内容不变，便于链式后续操作） */
  etag: string;
  /** 因移动而更新了链接的文件（F12） */
  updated: string[];
  /** 无法唯一解析、保持原样的链接（E11） */
  ambiguous: Array<{ path: string; link: string }>;
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

  const current = await readFile(fromAbs, "utf8");
  assertEtagMatches(current, input.if_match, fromRel);

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

  // 移动前扫描全量笔记：链接解析以移动前的路径状态为准（F12）
  const notes = await listVaultNotes(vault);
  await mkdir(path.dirname(toAbs), { recursive: true });
  await rename(fromAbs, toAbs);
  const linkUpdate = await updateLinksAfterMove(vault, notes, fromRel, toRel);
  return {
    from: fromRel,
    to: toRel,
    etag: computeEtag(current),
    updated: linkUpdate.updated,
    ambiguous: linkUpdate.ambiguous,
  };
}

export const moveNoteTool = {
  name: "move_note",
  description:
    "移动或重命名 Obsidian vault 中的笔记，并自动更新 vault 内指向该笔记的 [[wikilink]] 与 Markdown 相对链接（无法唯一解析的歧义链接保持原样并在结果中报告）；被移动笔记自身的相对链接也会重新指向正确位置。目标已存在时报错且不覆盖；目标父目录不存在时自动创建。",
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
  if_match: z
    .string()
    .optional()
    .describe("乐观锁：传入上次 read_note 返回的 etag，与当前内容不符时拒绝删除"),
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

  if (input.if_match !== undefined) {
    const current = await readFile(abs, "utf8");
    assertEtagMatches(current, input.if_match, rel);
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
