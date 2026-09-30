# obsidian-mcp

[![CI](https://github.com/Soleil1043/obsidian-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Soleil1043/obsidian-mcp/actions/workflows/ci.yml)

一个连接 Obsidian vault 的 MCP（Model Context Protocol）服务器：让 ZCode、Claude Code 等 AI harness 能浏览、搜索、编辑已有笔记，并把生成的内容作为新笔记写入 Obsidian。

- 直接文件系统访问 vault，**无需 Obsidian 运行**
- 8 个细粒度 MCP 工具，stdio transport
- TypeScript strict 实现，内置防误删/防误改保护与 etag 并发控制

## 工具清单

| 工具 | 功能 | 关键参数 |
|------|------|---------|
| `list_notes` | 列出目录下的笔记与文件夹（跳过 `.obsidian/`、`.trash/` 等隐藏条目与附件） | `folder?` |
| `read_note` | 读取笔记全文（UTF-8 原文，含 frontmatter）+ 大小/修改时间/内容 etag | `path` |
| `search_notes` | 关键词全文搜索（纯文本子串，非正则），返回文件/行号/行内容/文件命中总数 | `query`、`folder?`、`case_sensitive?`、`max_results?` |
| `create_note` | 创建笔记，父目录自动创建 | `path`、`content?`、`overwrite?`、`if_match?` |
| `edit_note` | 整体覆盖 / 末尾追加 / 精准替换（`overwrite` / `append` / `replace` 三模式） | `path`、`mode`、`content`、`old_string?`、`replace_all?`、`if_match?` |
| `move_note` | 重命名 / 移动笔记，自动更新指向它的 `[[wikilink]]` 与 Markdown 相对链接 | `from`、`to`、`if_match?` |
| `delete_note` | 删除笔记（默认进 vault 根 `.trash/`） | `path`、`permanent?`、`if_match?` |
| `manage_frontmatter` | YAML frontmatter 字段管理：get / set / delete（自动创建、删空移除整块、YAML 损坏拒绝写入） | `path`、`action`、`key?`、`value?`、`if_match?` |

所有路径均为 **vault 内相对路径**（POSIX 风格，如 `journal/2026-09-30.md`），必须以 `.md` 结尾。

## 安全与保护行为

- **路径穿越防护**：`..`、绝对路径、盘符路径一律拒绝，所有操作限制在 vault 根内
- **仅 Markdown**：非 `.md` 目标（图片、`.canvas` 等）拒绝操作
- **删除可恢复**：`delete_note` 默认移入 vault 根 `.trash/`（Obsidian 原生可恢复），同名自动加时间戳后缀；`permanent=true` 才永久删除
- **编辑防误伤**：`replace` 模式要求片段唯一——未找到或多处匹配时报错且文件不变，需显式 `replace_all=true` 才全量替换
- **不静默覆盖**：`create_note` / `move_note` 遇已存在目标默认报错，覆盖需显式 `overwrite=true`（move 不提供覆盖）

## 安装与构建

```bash
git clone https://github.com/Soleil1043/obsidian-mcp.git
cd obsidian-mcp
npm install
npm run build   # 产物输出 dist/
```

Node.js ≥ 20。

## 接入 AI harness

服务器通过 stdio transport 运行，任何支持 MCP 的客户端都可用以下方式接入：

| 配置项 | 值 |
|--------|-----|
| command | `node`（或 `npx obsidian-mcp`，发布 npm 后） |
| args | 项目内 `dist/index.js` 的绝对路径 |
| env | `OBSIDIAN_VAULT_PATH` = 你的 vault 绝对路径 |

**ZCode / Claude Code 等通用 MCP 配置（JSON）**：

```json
{
  "mcpServers": {
    "obsidian-mcp": {
      "command": "node",
      "args": ["D:/Code/vibecoding/mcp/obsidian-mcp/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "D:/Obsidian/MyVault"
      }
    }
  }
}
```

**Claude Code CLI**：

```bash
claude mcp add obsidian-mcp --env OBSIDIAN_VAULT_PATH=D:/Obsidian/MyVault -- node D:/Code/vibecoding/mcp/obsidian-mcp/dist/index.js
```

**手动验证**（MCP Inspector）：

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

### 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `OBSIDIAN_VAULT_PATH` | 是 | Obsidian vault 的绝对路径，支持 `~` 展开；未设置或路径无效时 server 启动即报错退出 |

## 开发

```bash
npm test          # 运行全部测试（vitest）
npm run test:watch
npm run build     # tsc 编译到 dist/
```

```
src/
├── index.ts        # stdio 入口（E01 启动校验）
├── server.ts       # MCP server 与工具注册
├── vault.ts        # Vault 核心：路径安全与归一化
├── errors.ts       # 统一错误类型
└── tools/          # 每个工具一个文件
tests/              # vitest（单元 + InMemory 协议集成测试）
.agent/             # SDD 项目状态（spec / plan / tasks / progress / decisions）
```

## 状态

MVP 已按 SDD 范式完成（spec v1.0，11/11 任务）。需求文档见 `.agent/spec.md`，技术方案见 `.agent/plan.md`，构建日志见 `.agent/progress.md`。
