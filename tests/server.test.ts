import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { afterEach, describe, expect, it } from "vitest";

import { createMcpServer } from "../src/server";
import type { Vault } from "../src/vault";
import { cleanupTempVaults, makeFixtureVault } from "./helpers";

afterEach(() => {
  cleanupTempVaults();
});

const EXPECTED_TOOL_NAMES = [
  "create_note",
  "delete_note",
  "edit_note",
  "list_notes",
  "manage_frontmatter",
  "manage_tags",
  "move_note",
  "read_note",
  "search_notes",
].sort();

async function connectClient(vault: Vault) {
  const server = createMcpServer(vault);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  const first = result.content[0];
  if (first?.type !== "text" || typeof first.text !== "string") {
    throw new Error(`expected text content, got: ${JSON.stringify(result.content)}`);
  }
  return first.text;
}

describe("MCP server 装配（E01 + F01-F06）", () => {
  it("注册全部 7 个工具", async () => {
    const { server, client } = await connectClient(makeFixtureVault());
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOL_NAMES);
    await client.close();
    await server.close();
  });

  it("list_notes 经 MCP 调用返回 JSON 结果", async () => {
    const { server, client } = await connectClient(makeFixtureVault());
    const result = await client.callTool({ name: "list_notes", arguments: {} });
    expect(result.isError).toBeFalsy();
    const entries = JSON.parse(textOf(result));
    expect(entries.some((entry: { path: string }) => entry.path === "journal")).toBe(true);
    expect(
      entries.some(
        (entry: { path: string; type: string }) =>
          entry.path === "note.md" && entry.type === "note",
      ),
    ).toBe(true);
    await client.close();
    await server.close();
  });

  it("read_note 与 search_notes 走通完整协议", async () => {
    const { server, client } = await connectClient(makeFixtureVault());

    const read = await client.callTool({
      name: "read_note",
      arguments: { path: "note.md" },
    });
    expect(read.isError).toBeFalsy();
    expect(JSON.parse(textOf(read))).toMatchObject({ path: "note.md", content: "# hello\n" });

    const search = await client.callTool({
      name: "search_notes",
      arguments: { query: "hello" },
    });
    expect(search.isError).toBeFalsy();
    const hits = JSON.parse(textOf(search));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ path: "note.md", line_number: 1 });

    await client.close();
    await server.close();
  });

  it("域错误返回 isError 与错误码，不打崩连接", async () => {
    const { server, client } = await connectClient(makeFixtureVault());
    const result = await client.callTool({
      name: "read_note",
      arguments: { path: "ghost.md" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("NOT_FOUND");

    const after = await client.callTool({ name: "list_notes", arguments: { folder: "" } });
    expect(after.isError).toBeFalsy();
    await client.close();
    await server.close();
  });

  it("参数不符合 schema 时返回 isError", async () => {
    const { server, client } = await connectClient(makeFixtureVault());
    const result = await client.callTool({ name: "read_note", arguments: {} });
    expect(result.isError).toBe(true);
    await client.close();
    await server.close();
  });
});
