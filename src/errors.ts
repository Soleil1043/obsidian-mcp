/**
 * Vault 域错误：统一错误码 + 人可读消息。
 * MCP 工具层（T010 装配）负责将其映射为 isError 的 tool result，不抛出到进程。
 */
export type VaultErrorCode =
  | "VAULT_PATH_NOT_SET" // E01: OBSIDIAN_VAULT_PATH 未设置
  | "VAULT_NOT_FOUND" // E01: 路径不存在
  | "VAULT_NOT_A_DIRECTORY" // E01: 路径不是目录
  | "INVALID_PATH" // 空字节等非法输入
  | "PATH_NOT_RELATIVE" // E05: 绝对路径（根路径 / 盘符）
  | "PATH_ESCAPES_VAULT" // E05: `..` 越出 vault 根
  | "NOT_MARKDOWN"; // E06: 目标不是 .md 文件

export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}
