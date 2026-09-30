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
    this.root = path.resolve(root);
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
   * 把 vault 内相对路径解析为绝对平台路径；空字符串解析为根目录。
   * 拒绝：绝对路径（`/` 开头或盘符）、任何 `..` 段、空字节；
   * Windows 上反斜杠视为路径分隔符，`.` 段与重复分隔符会被归一化。
   */
  resolvePath(relativePath: string): string {
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
    const joined = path.join(this.root, ...segments);
    // 防御性兜底：segments 已排除 ".."，此处保证结果必在根内
    if (joined !== this.root && !joined.startsWith(this.root + path.sep)) {
      throw new VaultError("PATH_ESCAPES_VAULT", `路径越出 vault 根: ${relativePath}`);
    }
    return joined;
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
