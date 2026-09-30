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
  | "NOT_MARKDOWN" // E06: 目标不是 .md 文件
  | "NOT_FOUND" // E02: vault 内目标（笔记/目录）不存在
  | "NOT_A_DIRECTORY" // 目标存在但不是目录
  | "NOT_A_FILE" // 目标存在但是目录而非文件
  | "INVALID_INPUT" // 工具参数非法（空关键词、越界数值等）
  | "ALREADY_EXISTS" // E03/E08: 目标已存在
  | "REPLACE_NOT_FOUND" // E04: 待替换片段未找到
  | "REPLACE_AMBIGUOUS"; // E04: 待替换片段匹配多处

export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}
