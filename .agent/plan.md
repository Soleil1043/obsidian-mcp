# 设计说明书 (Plan)

> Phase 2（方案设计）产出。基于 spec.md 设计架构；对话式迭代，必须由用户主动宣布"方案设计阶段结束，进入任务拆解"后才进入 Phase 3。
> 状态标记：✅ 已确认 | 🔄 待确认 | ❌ 需修改

**状态**：✅ 已确认

---

## 1. 技术选型

> 每个选择在对话中讨论确定，附优势与代价；存在多个可行方向时，先对比讨论、经用户确认后再写入本表。

| 层面 | 选择 | 理由 | 代价/权衡 |
|------|------|------|----------|
| 语言 | TypeScript 5.x（strict） | MCP 官方 SDK 原生 TS，类型即文档 | 需构建步骤，运行产物为 JS |
| 运行时 | Node.js ≥ 20 | SDK 最低要求；LTS 稳定 | 用户需预装 Node 环境 |
| MCP 框架 | @modelcontextprotocol/sdk | 官方维护，stdio transport 开箱即用 | 版本跟随 SDK 演进 |
| 入参校验 | zod | SDK 工具注册的标准搭配，schema 声明即校验 | 每个工具多一层 schema 定义 |
| frontmatter | js-yaml ^5 | 解析/序列化同引擎，正文保真可控（D007） | 定界符切分逻辑自担（约 30 行，已测试覆盖） |
| 构建 | tsc | 纯类型编译足够，产物直接作 bin 入口 | 无 bundler 体积优化 |
| 包管理 | npm | Node 自带，零额外安装 | 锁文件体积较大 |
| 测试 | vitest | 对 TS/ESM 零配置，临时目录 fixture 方便 | 与 jest 生态不互通 |
| CI/托管 | GitHub Actions + 公开仓库 | push 自动跑矩阵测试；windows 位守护 Windows 路径兼容 | 源码公开；CI 分钟数消耗 |

## 2. 目录结构

```
obsidian-mcp/
├── src/
│   ├── index.ts          # 入口：校验 OBSIDIAN_VAULT_PATH（E01），启动 stdio server
│   ├── server.ts         # 创建 MCP server，注册全部 10 个工具
│   ├── vault.ts          # Vault 核心：根路径解析、路径安全与归一化（E05）、.md 校验（E06）
│   ├── errors.ts         # 统一错误类型，映射为 MCP tool error
│   ├── etag.ts           # etag 计算与 if_match 乐观锁校验（F11/E10）
│   ├── links.ts          # wikilink / Markdown 相对链接解析与重写（F12/E11）
│   └── tools/
│       ├── list.ts       # list_notes         (F01)
│       ├── read.ts       # read_note          (F02, 返回 etag)
│       ├── search.ts     # search_notes v2    (F03/F10: 分页/排序/标签过滤)
│       ├── create.ts     # create_note        (F04, if_match)
│       ├── edit.ts       # edit_note          (F05, if_match)
│       ├── organize.ts   # move_note(含链接维护)/delete_note (F06/F12, if_match)
│       ├── frontmatter.ts# manage_frontmatter (F07)
│       ├── tags.ts       # manage_tags        (F08)
│       └── folders.ts    # create_folder      (F09)
├── tests/
│   ├── helpers.ts        # 公共 fixture 与断言助手
│   ├── vault.test.ts     # 路径安全（E05/E06）单元测试
│   ├── server.test.ts    # MCP 装配集成测试（真实 Client + InMemory transport）
│   ├── tools.test.ts     # 工具行为测试，临时目录构造 fixture vault
│   ├── links.test.ts     # 链接维护测试（F12/E11）
│   └── smoke.test.ts     # 测试链路冒烟
├── .github/workflows/ci.yml  # 矩阵 CI：ubuntu/windows × Node 20/24
├── .agent/               # 项目状态（SDD 文档）
├── AGENTS.md
├── README.md
├── package.json          # bin 字段指向 dist/index.js
├── tsconfig.json
└── vitest.config.ts
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
| etag | string | 内容 SHA-256（64 位 hex，F11 乐观锁凭据） |

### SearchHit / SearchResult（F03/F10 返回项）

| 字段 | 类型 | 说明 |
|------|------|------|
| path | string | 命中文件路径 |
| line_number | number | 命中行号（1 起） |
| line_text | string | 命中行原文 |
| match_count | number | 该文件总命中次数 |

search_notes v2 返回 `{ hits: SearchHit[], next_cursor: string \| null }`：next_cursor 为 opaque base64url 游标（含 offset），翻尽为 null（F10/E13）。

### 错误契约（所有工具）

错误统一以 MCP `isError: true` 的 tool result 返回，`content[0].text` 为人可读原因（如 `note not found: <path>`、`path escapes vault root: <path>`），不抛未捕获异常导致进程退出。错误码枚举：E01 前置三类、NOT_FOUND（E02）、ALREADY_EXISTS（E03/E08）、REPLACE_NOT_FOUND / REPLACE_AMBIGUOUS（E04）、E05 两类、E06、INVALID_INPUT、ETAG_MISMATCH（E10）、FRONTMATTER_INVALID（E12）、KEY_NOT_FOUND、INTERNAL_ERROR。

## 4. MCP 工具设计

> 无 REST API；对外接口即 MCP 工具。下表覆盖全部 Fxx：F01→A01，F02→A02，F03/F10→A03，F04→A04，F05→A05，F06→A06/A07，F07→A08，F08→A09，F09→A10，F11→A12，F12→A13。

| 编号 | 工具名 | 描述 | 对应需求 | 输入参数（zod schema） | 输出 / 行为 |
|------|--------|------|---------|----------------------|------------|
| A01 | `list_notes` | 列出目录下的笔记与文件夹 | F01 | `folder?: string`（默认根目录） | `VaultEntry[]`；空目录返回 `[]`；默认跳过 `.obsidian/`、`.trash/` 等隐藏目录 |
| A02 | `read_note` | 读取笔记全文 | F02 | `path: string` | `NoteContent`（含 etag）；E02 not found |
| A03 | `search_notes` | 关键词全文搜索（v2） | F03/F10 | `query: string`，`folder?: string`，`case_sensitive?: boolean = false`，`sort?: "path" \| "modified" \| "matches" = "path"`，`tag?: string`，`cursor?: string`，`max_results?: number = 100` | `{ hits, next_cursor }`；E09 空列表；E13 非法游标报 INVALID_INPUT；跳过隐藏目录 |
| A04 | `create_note` | 创建笔记 | F04 | `path: string`，`content?: string = ""`，`overwrite?: boolean = false`，`if_match?: string` | 创建成功返回路径；E03 已存在且未 `overwrite` 报错；父目录不存在时自动创建；`overwrite=true` 时校验 if_match（F11） |
| A05 | `edit_note` | 编辑笔记 | F05 | `path: string`，`mode: "overwrite" \| "append" \| "replace"`，`content: string`，`old_string?: string`（replace 必填），`replace_all?: boolean = false`，`if_match?: string` | 按 mode 修改；E04 未找到/多处匹配报错且文件不变；返回编辑后 etag |
| A06 | `move_note` | 重命名/移动笔记 | F06/F12 | `from: string`，`to: string`，`if_match?: string` | 移动成功返回新路径 + `updated`（被改写链接的文件列表）+ `ambiguous`（E11 歧义报告）；E08 目标已存在报错且原文件不动 |
| A07 | `delete_note` | 删除笔记 | F06 | `path: string`，`permanent?: boolean = false`，`if_match?: string` | 默认移入 vault 根 `.trash/`（E07，同名冲突自动加时间戳后缀）；`permanent=true` 才永久删除 |
| A08 | `manage_frontmatter` | frontmatter 字段管理 | F07 | `path: string`，`action: "get" \| "set" \| "delete"`，`key?: string`，`value?: unknown`，`if_match?: string` | get 无 key 返回整个对象 / 带 key 返回 found+value；set 自动创建 frontmatter；delete 删到空整块移除；E12 YAML 损坏三动作均拒绝且不写盘 |
| A09 | `manage_tags` | 标签管理 | F08 | `path?: string`，`action: "list" \| "add" \| "remove"`，`tags?: string[]`，`folder?: string`（list 限定），`if_match?: string` | list 全 vault 双来源统计（frontmatter tags + 行内 `#tag`，按笔记去重）；add/remove 精确整词，保留嵌套子标签，代码块内不误伤 |
| A10 | `create_folder` | 创建目录 | F09 | `path: string` | 父级不存在自动创建；已存在报错；点开头隐藏目录（含路径中间段）→ INVALID_INPUT |
| A11 | `search_notes` v2 增强 | + cursor/sort/tag | F10 | 见 A03 | 全量扫描后排序再切片（不提前截断）；tag 过滤复用 A09 的标签扫描 |
| A12 | 写工具 `if_match` | 乐观锁 | F11 | edit/create(overwrite)/move/delete 新增可选 `if_match` | 提供且与当前内容不符时抛 ETAG_MISMATCH（E10），校验先于写盘，文件不变；未提供时行为完全不变 |
| A13 | `move_note` v2 | + 反向链接更新 | F12 | 见 A06 | 见 A06 及下方实现要点 |

路径约定（适用于全部工具）：路径必须是 vault 内相对路径；不带 `.md` 后缀不自动补全，非 `.md` 目标一律拒绝（E06）；目录不存在按 E02 报错（创建工具除外）。

### 工具实现要点

- **etag 设计（F11）**：`etag` = 内容 SHA-256（64 位 hex）；`assertEtagMatches` 在写盘前校验，不符抛 ETAG_MISMATCH（报错含期望/实际 etag 前缀）；`if_match` 可选，旧调用方式不受影响。
- **链接解析（F12）**：`links.ts` 解析 `[[path]]`、`[[path|alias]]`、`[[path#heading]]`、`[[path#^block]]` 与 `[text](relative.md)`（%20 与 `<>` 解码）；move 前建立 vault 全量 `.md` 路径索引，重写唯一可解析的引用；按文件名短路径解析仍无法唯一定位的歧义链接不改并在返回中报告（E11）；fenced code block 内链接不动；被移动笔记自身的相对链接按旧目录解析、重写为从新目录出发。
- **frontmatter（F07）**：js-yaml load/dump（lineWidth -1 防折行）+ 自定义定界符切分（无闭合定界符视为普通文本）；set/delete 后正文逐字节保真（E12 硬约束，D007）。
- **tags（F08）**：行内标签正则带前后边界（不匹配标题/URL 锚点/嵌套父串），跳过 fenced code block，纯数字标签按 Obsidian 规则排除；删空 frontmatter 整块移除。
- **搜索 v2（F10）**：游标为 opaque base64url（含 offset），非法/负值报 INVALID_INPUT（E13）；sort = path（默认）/ modified（mtime 降序）/ matches（命中数降序），mtimeMs 仅内部排序不外泄。

## 5. 第三方依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| @modelcontextprotocol/sdk | ^1.31.0 | MCP server 框架、stdio transport |
| zod | ^4.6.5 | 工具入参 schema 声明与校验 |
| js-yaml | ^5.4.2 | frontmatter YAML 解析与序列化（D007） |
| typescript（dev） | ^7.0.2 | 编译 |
| @types/node（dev） | ^26.6.3 | Node 类型 |
| vitest（dev） | ^5.0.2 | 测试框架 |

## 6. 关键技术决策

> 同步写入 decisions.md（D002-D007）。

- **工具粒度（D002）**：细粒度工具而非 1 个大工具加 action 参数——schema 简单、描述明确，LLM 调用更可靠；仅 `edit_note` 合并 overwrite/append/replace 三种模式，因其参数高度重叠且作用于同一资源。
- **删除策略（D003）**：默认移入 vault 根 `.trash/` 而非系统回收站——`.trash/` 是 Obsidian 原生约定，且系统回收站 API 跨平台不一致；永久删除需显式 `permanent=true`。
- **搜索实现（D004）**：同步遍历 + 逐行匹配，不引入索引/外部引擎——个人 vault 规模（数千文件内）性能足够；默认排除 `.obsidian/`、`.trash/`。
- **并发控制（D005）**：内容 etag（SHA-256）+ `if_match` 乐观锁——无锁文件残留、跨平台、与 HTTP ETag 语义一致；可选参数保持向后兼容。
- **frontmatter 解析（D007）**：直接使用 js-yaml 而非 gray-matter——E12 要求正文逐字节保真，工具层需完全控制文本重组；js-yaml 是 gray-matter 的底层引擎，"成熟解析器"意图不变。
