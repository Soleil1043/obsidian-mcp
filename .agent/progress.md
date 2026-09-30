# 构建日志 (Progress)

> Phase 4 产出。每完成一个任务追加一条记录，只追加不删除。
> 格式：时间 | 任务编号 | 操作 | 涉及文件 | 验证方式 | 状态

---

## 日志条目

<!-- 每条记录格式：
### [T0XX] 任务名称 — YYYY-MM-DD HH:MM

**操作**：
- 创建/修改了哪些文件

**涉及文件**：
- `path/to/file.py` — [做了什么]

**验证方式**：
- [运行什么命令 / 看什么结果]

**状态**：✅ 通过验证 / ❌ 有问题（附描述）

**Git**：`abc1234` feat: T0XX 任务名称
-->

### [T001] 项目初始化与构建骨架 — 2026-09-30

**操作**：
- 创建 package.json、tsconfig.json、vitest.config.ts、.gitignore、src/index.ts 占位入口、tests/smoke.test.ts 冒烟测试
- 安装运行时依赖 @modelcontextprotocol/sdk、zod，开发依赖 typescript、@types/node、vitest

**涉及文件**：
- `package.json` — 项目元信息、ESM、bin 指向 dist/index.js、build/test 脚本；npm 解析写入实际依赖版本
- `tsconfig.json` — strict + NodeNext 模块，产物输出 dist/
- `vitest.config.ts` — 测试文件限定 tests/**/*.test.ts
- `src/index.ts` — 占位入口（server 装配在 T010）
- `tests/smoke.test.ts` — 测试链路冒烟用例

**验证方式**：
- `npm run build` 成功；`npm test` 1 passed；`node dist/index.js` 输出占位信息

**状态**：✅ 通过验证（待用户确认）

**Git**：见下方 T001 commit

### [T002] Vault 核心与路径安全 — 2026-09-30

**操作**：
- 新增统一错误类型与 Vault 核心类，含 15 个单元测试；修复 TS7 下 @types/node 未自动引入的问题（tsconfig 显式 types: ["node"]）

**涉及文件**：
- `src/errors.ts` — VaultError（错误码：E01 前置三类、INVALID_PATH、E05 两类、E06），供工具层映射为 MCP isError result
- `src/vault.ts` — Vault.fromEnv（OBSIDIAN_VAULT_PATH 解析、~ 展开、E01 校验）、resolvePath（POSIX 相对路径归一化、拒绝 `..`/绝对路径/空字节、根内兜底校验）、resolveMarkdownPath（仅 .md，大小写不敏感）
- `tests/vault.test.ts` — 15 个用例覆盖 E05/E06 与 fromEnv 各分支；临时目录 fixture，跨平台条件用例（win32 反斜杠）
- `tsconfig.json` — 补 "types": ["node"]

**验证方式**：
- `npm run build` 成功；`npm test` 16 passed（含 smoke 1 个）

**状态**：✅ 通过验证（待用户确认）

**Git**：见下方 T002 commit

### [T003] list_notes 工具 — 2026-09-30

**操作**：
- 新增第一个 MCP 工具 list_notes（F01）；vault.ts 提取 normalizeRelative 公开方法供工具层显示路径用；errors.ts 补 NOT_FOUND、NOT_A_DIRECTORY 两个工具层错误码

**涉及文件**：
- `src/tools/list.ts` — listNotes 处理器 + zod schema + listNotesTool 定义（T010 装配用）；文件夹在前、名称排序（数值感知）；跳过点开头隐藏条目与非 .md 文件；ENOENT→NOT_FOUND、非目录→NOT_A_DIRECTORY
- `src/vault.ts` — normalizeRelative 从 resolvePath 中提取（行为不变，tests 全绿）
- `src/errors.ts` — 错误码新增 NOT_FOUND（E02）、NOT_A_DIRECTORY
- `tests/tools.test.ts` — 7 个用例：根/子目录列表与排序、空目录、省略=留空、NOT_FOUND、NOT_A_DIRECTORY、E05 传播；修复了测试助手中未 await 的 Promise（教训：expectVaultError 需统一 await）

**验证方式**：
- `npm run build` 成功；`npm test` 23 passed（smoke 1 + vault 15 + tools 7）

**状态**：✅ 通过验证（待用户确认）

**Git**：见下方 T003 commit

### [T004] read_note 工具 — 2026-09-30

**操作**：
- 新增 read_note 工具（F02），返回 content/size_bytes/modified_at；errors.ts 补 NOT_A_FILE 错误码

**涉及文件**：
- `src/tools/read.ts` — readNote 处理器 + zod schema + readNoteTool 定义；UTF-8 原文直读不改动（含 frontmatter 与 BOM）；ENOENT→NOT_FOUND（E02）；目录冒名（以 .md 结尾的目录）→NOT_A_FILE
- `src/errors.ts` — 错误码新增 NOT_A_FILE
- `tests/tools.test.ts` — 新增 6 个用例：逐字一致+元数据、子目录归一化路径、win32 反斜杠、E02 不存在且不创建、E06 非 .md、NOT_A_FILE

**验证方式**：
- `npm run build` 成功；`npm test` 29 passed（smoke 1 + vault 15 + tools 13）

**状态**：✅ 通过验证（待用户确认）

**Git**：见下方 T004 commit

### [T005] search_notes 工具 — 2026-09-30

**操作**：
- 新增 search_notes 工具（F03），同步遍历 + 逐行匹配（决策 D004）；errors.ts 补 INVALID_INPUT 错误码

**涉及文件**：
- `src/tools/search.ts` — searchNotes 处理器：纯文本子串匹配（非正则）、默认大小写不敏感、folder 限定、max_results 默认 100 上限 1000、行级命中 + 文件级 match_count、文件粒度截断；递归收集 .md（withFileTypes + parentPath），跳过点开头隐藏目录；ENOENT 文件竞态静默跳过
- `src/errors.ts` — 错误码新增 INVALID_INPUT（空关键词、非正整数 max_results）
- `tests/tools.test.ts` — 新增 7 个用例（独立 search fixture）：默认匹配全集、大小写敏感、folder 限定、E09 空列表、截断、INVALID_INPUT、目录类错误

**验证方式**：
- `npm run build` 成功；`npm test` 36 passed（smoke 1 + vault 15 + tools 20）

**状态**：✅ 通过验证（待用户确认）

**Git**：见下方 T005 commit

### [T006] create_note 工具 — 2026-09-30

**操作**：
- 新增 create_note 工具（F04），第一个写侧工具；errors.ts 补 ALREADY_EXISTS 错误码

**涉及文件**：
- `src/tools/create.ts` — createNote 处理器：resolveMarkdownPath 校验 → stat 检查（目录冒名 NOT_A_FILE / 已存在 ALREADY_EXISTS（E03））→ mkdir recursive 建父目录 → writeFile；返回归一化路径与字节数
- `src/errors.ts` — 错误码新增 ALREADY_EXISTS（E03，后续 move 冲突 E08 复用）
- `tests/tools.test.ts` — 新增 6 个用例：多级父目录自动创建且内容落盘一致、空内容默认、E03 报错且原文件不变、overwrite 覆盖、E05/E06 拒绝、win32 反斜杠

**验证方式**：
- `npm run build` 成功；`npm test` 42 passed（smoke 1 + vault 15 + tools 26）

**状态**：✅ 通过验证（待用户确认）

**Git**：见下方 T006 commit

### [T007] edit_note 工具 — 2026-09-30

**操作**：
- 新增 edit_note 工具（F05），overwrite/append/replace 三模式合一（决策 D002）；errors.ts 补 REPLACE_NOT_FOUND、REPLACE_AMBIGUOUS 错误码

**涉及文件**：
- `src/tools/edit.ts` — editNote 处理器：stat/read → 按 mode 计算 next → 内容有变化才写回（避免无谓 mtime 变动）。replace 用 split/join 字面替换（规避 String.replace 的 "$&" 替换模式解析）；未找到 → REPLACE_NOT_FOUND、多处且未 replace_all → REPLACE_AMBIGUOUS，报错均发生在写盘前，文件保持不变（E04）；缺/空 old_string → INVALID_INPUT
- `src/errors.ts` — 错误码新增 REPLACE_NOT_FOUND、REPLACE_AMBIGUOUS（E04）
- `tests/tools.test.ts` — 新增 9 个用例：三模式基础行为、$ 符号字面替换、E04 未找到/多处（断言文件不变）、replace_all、空串删除片段、INVALID_INPUT、E02 不存在不创建

**验证方式**：
- `npm run build` 成功；`npm test` 51 passed（smoke 1 + vault 15 + tools 35）

**状态**：✅ 通过验证（待用户确认）

**Git**：见下方 T007 commit

### [T008] move_note 工具 — 2026-09-30

**操作**：
- 新增 organize.ts 与 move_note 工具（F06）；不覆盖目标（E08），源文件在所有报错路径下保持原位

**涉及文件**：
- `src/tools/organize.ts` — moveNote 处理器：from/to 双路径 vault 校验 → from===to INVALID_INPUT → from 存在性/文件检查 → to 已存在 ALREADY_EXISTS（E08，不提供 overwrite）→ mkdir 目标父目录 → rename。T009 的 delete_note 将加入同文件
- `tests/tools.test.ts` — 新增 5 个用例：重命名、跨目录移动（父目录自动创建）、E08 报错后断言源与目标均未变、源类错误三连、E05/E06 拒绝且源不受影响

**验证方式**：
- `npm run build` 成功；`npm test` 56 passed（smoke 1 + vault 15 + tools 40）

**状态**：✅ 通过验证（待用户确认）

**Git**：见下方 T008 commit

### [T009] delete_note 工具 — 2026-09-30

**操作**：
- organize.ts 增加 delete_note 工具（F06/E07），七个工具全部完成

**涉及文件**：
- `src/tools/organize.ts` — deleteNote 处理器：默认移入 vault 根 `.trash/`（D003），同名冲突加时间戳后缀（同毫秒冲突再加序号），返回 trash_path 告知去向；`permanent=true` 才 rm 永久删除；`.trash/` 内文件默认删除 → INVALID_INPUT 提示用 permanent（trash 是终点）
- `tests/tools.test.ts` — 新增 6 个用例：默认进 trash 且内容保留、同名冲突加后缀且不覆盖已有、permanent 永久删、trash 内文件引导 permanent、E02、E05/E06。修正两处测试断言（时间戳含 T、fixture 预置 .trash 目录）

**验证方式**：
- `npm run build` 成功；`npm test` 62 passed（smoke 1 + vault 15 + tools 46）

**状态**：✅ 通过验证（待用户确认）

**Git**：见下方 T009 commit

### [T010] MCP server 装配与 stdio 入口 — 2026-09-30

**操作**：
- 装配 7 个工具到 McpServer 并接通 stdio transport；测试公共 fixture 抽到 tests/helpers.ts

**涉及文件**：
- `src/server.ts` — createMcpServer：registerTool 循环注册（inputSchema 用 zod raw shape），工具结果 JSON 序列化返回；VaultError → isError result（`code: message`），未知错误 → INTERNAL_ERROR，不向 transport 抛异常
- `src/index.ts` — stdio 入口：fromEnv 失败时 stderr + exit(1)（E01）；shebang 供 bin/npx；诊断信息只走 stderr（stdout 是协议通道）
- `tests/helpers.ts` — makeFixtureVault / makeSearchVault / expectVaultError / cleanupTempVaults 抽公共
- `tests/tools.test.ts` — 改用 helpers（断言不变）
- `tests/server.test.ts` — 5 个集成用例：真实 MCP Client + InMemory transport，覆盖 7 工具注册、list/read/search 调用、域错误 isError 且连接存活、schema 校验错误

**验证方式**：
- `npm test` 67 passed（smoke 1 + vault 15 + server 5 + tools 46）
- E01 实测：无 OBSIDIAN_VAULT_PATH 时 `node dist/index.js` → stderr 提示 + exit=1
- 真实 stdio 端到端：管道发送 initialize/initialized/tools/list/tools/call → 7 工具全部列出；read_note 实读 AGENTS.md 返回正确内容，exit=0

**状态**：✅ 通过验证（待用户确认）

**Git**：见下方 T010 commit

### [T011] README 使用文档 — 2026-09-30

**操作**：
- 重写 README.md 为完整使用文档，全部 11 个任务完成

**涉及文件**：
- `README.md` — 项目简介、7 工具清单（参数级）、安全与保护行为、安装构建、harness 接入（通用 MCP JSON + Claude Code CLI + Inspector 验证）、环境变量说明、开发指南与目录结构、项目状态

**验证方式**：
- 按文档步骤可独立完成：npm install → npm run build → 配置 OBSIDIAN_VAULT_PATH → 接入 harness

**状态**：✅ 通过验证（待用户确认）

**Git**：见下方 T011 commit

---

## 问题追踪

<!-- 遇到的问题记录在此，方便回溯 -->
| 编号 | 任务 | 问题 | 解决方案 | 状态 |
|------|------|------|---------|------|
| - | - | - | - | - |
