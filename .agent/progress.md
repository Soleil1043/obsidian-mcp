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

---

## 问题追踪

<!-- 遇到的问题记录在此，方便回溯 -->
| 编号 | 任务 | 问题 | 解决方案 | 状态 |
|------|------|------|---------|------|
| - | - | - | - | - |
