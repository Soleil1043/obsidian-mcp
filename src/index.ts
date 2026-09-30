#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMcpServer } from "./server.js";
import { Vault } from "./vault.js";

async function main(): Promise<void> {
  let vault: Vault;
  try {
    vault = Vault.fromEnv();
  } catch (error) {
    // E01：配置缺失/无效在启动时暴露。stdio 模式下 stdout 是协议通道，诊断信息只能走 stderr。
    console.error(
      `[obsidian-mcp] 启动失败: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  const server = createMcpServer(vault);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(
    `[obsidian-mcp] 未捕获异常: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  );
  process.exit(1);
});
