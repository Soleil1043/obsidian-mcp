import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VaultError } from "./errors.js";

const MARKDOWN_SUFFIX = ".md";

/**
 * vault 根目录的解析与路径安全。
 * 对外路径一律是 POSIX 风格的 vault 相对路径（如 "journal/2026-09-30.md"），
 * 由本类转换为平台绝对路径；穿越与类型约束见 spec E05/E06。
 */
export class Vault {
  /** vault 根目录的绝对平台路径 */
  readonly root: string;

  constructor(root: string) {
    this.root = fs.realpathSync(path.resolve(root));
  }

  /** 从 OBSIDIAN_VAULT_PATH 构造 vault（E01：未设置 / 不存在 / 非目录时启动即报错）。 */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): Vault {
    const raw = env.OBSIDIAN_VAULT_PATH?.trim();
    if (!raw) {
      throw new VaultError(
        "VAULT_PATH_NOT_SET",
        "环境变量 OBSIDIAN_VAULT_PATH 未设置；请在 MCP 配置的 env 中将其指向 Obsidian vault 的绝对路径。",
      );
    }
    const expanded =
      raw === "~"
        ? os.homedir()
        : raw.startsWith("~/") || raw.startsWith("~\\")
          ? path.join(os.homedir(), raw.slice(2))
          : raw;
    const abs = path.resolve(expanded);
    if (!fs.existsSync(abs)) {
      throw new VaultError("VAULT_NOT_FOUND", `vault 路径不存在: ${abs}`);
    }
    if (!fs.statSync(abs).isDirectory()) {
      throw new VaultError("VAULT_NOT_A_DIRECTORY", `vault 路径不是目录: ${abs}`);
    }
    return new Vault(abs);
  }

  /**
   * 校验并归一化 vault 内相对路径，返回 POSIX 风格相对路径（根目录返回空字符串）。
   * 拒绝：绝对路径（`/` 开头或盘符）、任何 `..` 段、空字节；
   * Windows 上反斜杠视为路径分隔符，`.` 段与重复分隔符会被归一化。
   */
  normalizeRelative(relativePath: string): string {
    const input = relativePath.trim();
    if (input.includes("\0")) {
      throw new VaultError("INVALID_PATH", `路径包含非法字符（null byte）: ${JSON.stringify(relativePath)}`);
    }
    const posix = process.platform === "win32" ? input.replaceAll("\\", "/") : input;
    if (posix.startsWith("/") || /^[a-zA-Z]:/.test(posix)) {
      throw new VaultError("PATH_NOT_RELATIVE", `路径必须是 vault 内相对路径: ${relativePath}`);
    }
    const segments = posix.split("/").filter((segment) => segment !== "" && segment !== ".");
    if (segments.includes("..")) {
      throw new VaultError("PATH_ESCAPES_VAULT", `路径不允许包含 "..": ${relativePath}`);
    }
    return segments.join("/");
  }

  /** 归一化后转为绝对平台路径；空相对路径解析为根目录。 */
  resolvePath(relativePath: string): string {
    const normalized = this.normalizeRelative(relativePath);
    const joined = path.join(this.root, normalized);
    // 防御性兜底：segments 已排除 ".."，此处保证结果必在根内
    if (joined !== this.root && !joined.startsWith(this.root + path.sep)) {
      throw new VaultError("PATH_ESCAPES_VAULT", `路径越出 vault 根: ${relativePath}`);
    }
    this.assertWithinVault(normalized, relativePath);
    return joined;
  }

  /**
   * Verify component by component that the path does not escape the vault root
   * through symlinks.
   *
   * lstat every segment from the root down to the target: when a symlink is
   * found, resolve its real target and check that it is still inside the root,
   * then keep descending from the *resolved* location. Walking the resolved
   * path is what catches chained links and a symlinked parent directory.
   * Dangling symlinks are always rejected: their target does not exist yet, so
   * there is nothing proving it lands inside the root, while a following
   * `mkdir -p` / `writeFile` would create directories outside the vault.
   * The first non-existent segment ends the check: the segments after it have
   * not been created yet and therefore cannot form an escape.
   */
  private assertWithinVault(normalized: string, relativePath: string): void {
    const isInside = (candidate: string): boolean =>
      candidate === this.root || candidate.startsWith(this.root + path.sep);

    let current = this.root;
    for (const segment of normalized.split("/")) {
      if (segment === "") continue;
      const candidate = path.join(current, segment);

      let stats: fs.Stats;
      try {
        stats = fs.lstatSync(candidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }

      if (!stats.isSymbolicLink()) {
        current = candidate;
        continue;
      }

      let resolved: string;
      try {
        resolved = fs.realpathSync(candidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new VaultError(
            "PATH_ESCAPES_VAULT",
            `path contains a dangling symlink whose target cannot be confirmed inside the vault: ${relativePath}`,
          );
        }
        throw error;
      }
      if (!isInside(resolved)) {
        throw new VaultError("PATH_ESCAPES_VAULT", `symlink escapes the vault root: ${relativePath}`);
      }
      current = resolved;
    }

    if (!isInside(current)) {
      throw new VaultError("PATH_ESCAPES_VAULT", `path escapes the vault root: ${relativePath}`);
    }
  }

  /** resolvePath 并强制目标是 Markdown 文件（E06，后缀不区分大小写）。 */
  resolveMarkdownPath(relativePath: string): string {
    const abs = this.resolvePath(relativePath);
    if (path.basename(abs).toLowerCase().endsWith(MARKDOWN_SUFFIX)) {
      return abs;
    }
    throw new VaultError("NOT_MARKDOWN", `仅支持 .md 文件: ${relativePath}`);
  }
}
