import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";

import { VaultError } from "./errors.js";
import { createNoteTool } from "./tools/create.js";
import { editNoteTool } from "./tools/edit.js";
import { manageFrontmatterTool } from "./tools/frontmatter.js";
import { listNotesTool } from "./tools/list.js";
import { deleteNoteTool, moveNoteTool } from "./tools/organize.js";
import { readNoteTool } from "./tools/read.js";
import { searchNotesTool } from "./tools/search.js";
import { manageTagsTool } from "./tools/tags.js";
import type { Vault } from "./vault.js";

export const SERVER_NAME = "obsidian-mcp";
export const SERVER_VERSION = "0.1.0";

/**
 * 工具定义的装配视图。handler 的入参在各工具文件里是精确类型，
 * 注册循环处统一宽化（zod schema 在 SDK 边界已做校验，内部代码信任其 guarantee）。
 */
interface AnyTool {
  name: string;
  description: string;
  schema: { shape: Record<string, z.ZodType> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 装配边界，见上
  handler: (vault: Vault, input: any) => Promise<unknown>;
}

const TOOLS: AnyTool[] = [
  listNotesTool,
  readNoteTool,
  searchNotesTool,
  createNoteTool,
  editNoteTool,
  moveNoteTool,
  deleteNoteTool,
  manageFrontmatterTool,
  manageTagsTool,
];

export function createMcpServer(vault: Vault): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema.shape,
      },
      async (args) => {
        try {
          const result = await tool.handler(vault, args);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return toToolErrorResult(error);
        }
      },
    );
  }
  return server;
}

/** 域错误映射为 MCP isError result；不向 transport 抛异常，避免打崩 server 进程。 */
function toToolErrorResult(error: unknown): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  const text =
    error instanceof VaultError
      ? `${error.code}: ${error.message}`
      : `INTERNAL_ERROR: ${error instanceof Error ? error.message : String(error)}`;
  return { isError: true, content: [{ type: "text", text }] };
}
