# obsidian-mcp

一个连接 Obsidian vault 的 MCP（Model Context Protocol）服务器：让 ZCode、Claude Code 等 AI harness 能浏览、搜索、编辑已有文档，并将新文档写入 Obsidian。

## 技术栈

- TypeScript 5.x（strict）+ Node.js ≥ 20
- @modelcontextprotocol/sdk（stdio transport）
- 直接文件系统访问 vault（无需 Obsidian 运行）
- vitest 测试

## 状态

🚧 项目初始化中，按 SDD 范式推进（spec → plan → tasks）。文档将在 Phase 5 完善。
