import { mkdir, stat } from "node:fs/promises";

import { z } from "zod";

import { VaultError } from "../errors.js";
import type { Vault } from "../vault.js";

export const createFolderSchema = z.object({
  path: z
    .string()
    .describe("要创建的目录路径（vault 内 POSIX 风格相对路径；父目录不存在时自动创建；不允许点开头的隐藏目录）"),
});

export interface CreatedFolder {
  /** vault 内相对路径（归一化后） */
  path: string;
}

/** F09：创建目录。父级自动创建；已存在报 ALREADY_EXISTS；隐藏目录（点开头）与越界路径拒绝。 */
export async function createFolder(
  vault: Vault,
  input: z.input<typeof createFolderSchema>,
): Promise<CreatedFolder> {
  const rel = vault.normalizeRelative(input.path);
  if (rel === "") {
    throw new VaultError("INVALID_INPUT", "目录路径不能为空");
  }
  if (rel.split("/").some((segment) => segment.startsWith("."))) {
    throw new VaultError("INVALID_INPUT", `不允许创建点开头的隐藏目录: ${input.path}`);
  }
  const abs = vault.resolvePath(rel);

  let existing = null;
  try {
    existing = await stat(abs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing?.isDirectory()) {
    throw new VaultError("ALREADY_EXISTS", `目录已存在: ${rel}`);
  }
  if (existing) {
    throw new VaultError("NOT_A_FILE", `目标路径是文件: ${rel}`);
  }

  await mkdir(abs, { recursive: true });
  return { path: rel };
}

export const createFolderTool = {
  name: "create_folder",
  description:
    "在 Obsidian vault 中创建文件夹（多级父目录自动创建）。目录已存在时报错；点开头的隐藏目录（如 .obsidian 同类）与越出 vault 根的路径一律拒绝。",
  schema: createFolderSchema,
  handler: createFolder,
} as const;
