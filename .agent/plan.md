# 技术方案 (Plan)

> Phase 2 产出。基于 spec.md 设计架构，用户确认后进入 Phase 3。
> 状态标记：✅ 已确认 | 🔄 待确认 | ❌ 需修改

**状态**：✅ 已确认

---

## 1. 技术选型

| 层面 | 选择 | 理由 |
|------|------|------|
| 语言 | TypeScript 5.x（strict） | MCP 官方 SDK 原生 TS，类型即文档 |
| 运行时 | Node.js ≥ 20 | SDK 最低要求；LTS 稳定 |
| MCP 框架 | @modelcontextprotocol/sdk | 官方维护，stdio transport 开箱即用 |
| 入参校验 | zod | SDK 工具注册的标准搭配，schema 声明即校验 |
| 构建 | tsc | 纯类型编译足够，产物直接作 bin 入口 |
| 包管理 | npm | Node 自带，零额外安装 |
| 测试 | vitest | 对 TS/ESM 零配置，临时目录 fixture 方便 |

## 2. 目录结构

```
obsidian-mcp/
├── src/
│   ├── index.ts          # 入口：校验 OBSIDIAN_VAULT_PATH（E01），启动 stdio server
│   ├── server.ts         # 创建 MCP server，注册全部工具
│   ├── vault.ts          # Vault 核心：根路径解析、路径安全与归一化（E05）、.md 校验（E06）
│   ├── errors.ts         # 统一错误类型，映射为 MCP tool error
│   └── tools/
│       ├── list.ts       # list_notes   (F01)
│       ├── read.ts       # read_note    (F02)
│       ├── search.ts     # search_notes (F03)
│       ├── create.ts     # create_note  (F04)
│       ├── edit.ts       # edit_note    (F05)
│       └── organize.ts   # move_note / delete_note (F06)
├── tests/
│   ├── vault.test.ts     # 路径安全（E05/E06）单元测试
│   ├── tools.test.ts     # 工具行为测试，临时目录构造 fixture vault
│   └── fixtures/vault/   # 测试用样例 vault
├── .agent/
├── AGENTS.md
├── README.md
├── package.json          # bin 字段指向 dist/index.js，支持 npx 分发
└── tsconfig.json
```

## 3. 数据模型

> 本项目无数据库；数据模型即 MCP 工具的领域类型与错误契约。vault 内部一律使用 POSIX 风格相对路径（`folder/note.md`），由 vault 层转换为平台路径。

### VaultEntry（F01 返回项）

| 字段 | 类型 | 说明 |
|------|------|------|
| path | string | 相对 vault 根的路径 |
| name | string | 文件/文件夹名 |
| type | `"note" \| "folder"` | 条目类型 |

### NoteContent（F02 返回项）

| 字段 | 类型 | 说明 |
|------|------|------|
| content | string | 文件全文（UTF-8 原文，含 frontmatter） |
| size_bytes | number | 文件字节数 |
| modified_at | string | ISO 8601 修改时间 |

### SearchHit（F03 返回项）

| 字段 | 类型 | 说明 |
|------|------|------|
| path | string | 命中文件路径 |
| line_number | number | 命中行号（1 起） |
| line_text | string | 命中行原文 |
| match_count | number | 该文件总命中次数 |

### 错误契约（所有工具）

错误统一以 MCP `isError: true` 的 tool result 返回，`content[0].text` 为人可读原因（如 `note not found: <path>`、`path escapes vault root: <path>`），不抛未捕获异常导致进程退出。

## 4. MCP 工具设计

> 无 REST API；对外接口即 MCP 工具。下表覆盖全部 Fxx：F01→A01，F02→A02，F03→A03，F04→A04，F05→A05，F06→A06/A07。

| 编号 | 工具名 | 描述 | 对应需求 | 输入参数（zod schema） | 输出 / 行为 |
|------|--------|------|---------|----------------------|------------|
| A01 | `list_notes` | 列出目录下的笔记与文件夹 | F01 | `folder?: string`（默认根目录） | `VaultEntry[]`；空目录返回 `[]`；默认跳过 `.obsidian/`、`.trash/` 等隐藏目录 |
| A02 | `read_note` | 读取笔记全文 | F02 | `path: string` | `NoteContent`；E02 not found |
| A03 | `search_notes` | 关键词全文搜索 | F03 | `query: string`，`folder?: string`，`case_sensitive?: boolean = false`，`max_results?: number = 100` | `SearchHit[]`；E09 空列表；跳过隐藏目录 |
| A04 | `create_note` | 创建笔记 | F04 | `path: string`，`content?: string = ""`，`overwrite?: boolean = false` | 创建成功返回路径；E03 已存在且未 `overwrite` 报错；父目录不存在时自动创建 |
| A05 | `edit_note` | 编辑笔记 | F05 | `path: string`，`mode: "overwrite" \| "append" \| "replace"`，`content: string`，`old_string?: string`（replace 必填），`replace_all?: boolean = false` | 按 mode 修改；E04 未找到/多处匹配报错且文件不变 |
| A06 | `move_note` | 重命名/移动笔记 | F06 | `from: string`，`to: string` | 移动成功返回新路径；E08 目标已存在报错且原文件不动 |
| A07 | `delete_note` | 删除笔记 | F06 | `path: string`，`permanent?: boolean = false` | 默认移入 vault 根 `.trash/`（E07，同名冲突自动加时间戳后缀）；`permanent=true` 才永久删除 |

路径约定（适用于全部工具）：路径必须是 vault 内相对路径；不带 `.md` 后缀不自动补全，非 `.md` 目标一律拒绝（E06）；目录不存在按 E02 报错（创建工具除外）。

## 5. 第三方依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| @modelcontextprotocol/sdk | ^1.x | MCP server 框架、stdio transport |
| zod | ^3.x | 工具入参 schema 声明与校验 |
| gray-matter | ^4.x | frontmatter YAML 解析与序列化（v1.2 增补，见 D006） |
| typescript（dev） | ^5.x | 编译 |
| @types/node（dev） | ^20 | Node 类型 |
| vitest（dev） | ^2.x | 测试框架 |

## 6. 关键技术决策

> 同步写入 decisions.md（D002–D004）。

- **工具粒度**：7 个细粒度工具而非 1 个大工具加 action 参数——schema 简单、描述明确，LLM 调用更可靠；仅 `edit_note` 合并 overwrite/append/replace 三种模式，因其参数高度重叠且作用于同一资源。
- **删除策略**：默认移入 vault 根 `.trash/` 而非系统回收站——`.trash/` 是 Obsidian 原生约定，且系统回收站 API 跨平台不一致；永久删除需显式 `permanent=true`。
- **搜索实现**：同步遍历 + 逐行匹配，不引入索引/外部引擎——个人 vault 规模（数千文件内）性能足够；默认排除 `.obsidian/`、`.trash/`。

## 7. 交付管道（v1.1 增补）

- **CI**：GitHub Actions（`.github/workflows/ci.yml`），矩阵 `ubuntu-latest`/`windows-latest` × Node 20/24——windows 矩阵位用于守护本项目声明的 Windows 路径兼容；步骤 `npm ci → npm run build → npm test`。
- **托管**：公开仓库 `Soleil1043/obsidian-mcp`（gh CLI 创建并推送）；补 MIT LICENSE 文件与 package.json repository 元数据；README 加 CI 徽章与克隆指引。npm 发布暂不做。

## 8. v1.2 路线图（竞品对标增补）

> 优先级：正确性优先——F11 etag 并发控制 → F12 链接维护 → F07/F08 frontmatter/tags → F09/F10 目录/搜索 → F13 分发 → 英文文档。

- **etag 设计（F11）**：`read_note` 返回 `etag`（内容 SHA-256，64 位 hex）；`edit_note`、`create_note(overwrite=true)`、`move_note`、`delete_note` 新增可选 `if_match` 参数——提供且与当前内容不符时抛 `ETAG_MISMATCH`（新错误码），写入前校验，文件不变；未提供时行为完全不变。
- **链接解析（F12）**：新增 `src/links.ts`，解析 `[[path]]`、`[[path|alias]]`、`[[path#heading]]`、`[[path#^block]]` 与 `[text](relative.md)`；move 前建立 vault 全量 `.md` 路径索引，重写唯一可解析的引用；按文件名短路径解析仍无法唯一定位的歧义链接不改并在返回 `updated`/`ambiguous` 中报告（E11）。
- **frontmatter（F07）**：gray-matter 解析/序列化；`manage_frontmatter` 支持 get/set/delete；set 在无 frontmatter 时自动创建；YAML 损坏抛错且文件不变（E12）。
- **tags（F08）**：`manage_tags` = list（vault 全量，frontmatter `tags` + 行内 `#tag` 两来源）/ add / remove；行内标签只处理笔记正文中的 `#tag`（不含代码块内的，避免误伤——扫描时跳过 fenced code block）。
- **搜索 v2（F10）**：游标分页（opaque base64 cursor，含 offset；非法/过期 cursor → INVALID_INPUT，E13）；`sort` = `path`（默认）/`modified`/`matches`；`tag` 过滤（复用 F08 的标签扫描）。
- **v1.2 新增工具与变更**：
  | 编号 | 工具/变更 | 描述 | 对应需求 |
  |------|----------|------|---------|
  | A08 | `manage_frontmatter` | frontmatter 字段 get/set/delete | F07 |
  | A09 | `manage_tags` | 标签 list/add/remove | F08 |
  | A10 | `create_folder` | 创建目录（父级自动创建） | F09 |
  | A11 | `search_notes` v2 | + cursor/sort/tag | F10 |
  | A12 | 写工具 + `if_match` | edit/create/move/delete 乐观锁；read 返回 etag | F11 |
  | A13 | `move_note` v2 | + 反向链接更新 | F12 |
- **分发（F13）**：package.json `name` → `@soleil1043/obsidian-mcp`（原名被占用，见 spec 假设），新增 `"files": ["dist", "README.md", "LICENSE"]` 只发编译产物；`.github/workflows/release.yml`：push tag `v*` 时 npm publish --access public + GitHub Release 自动生成。工具注册处 SERVER_NAME 不变。
