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

---

## 问题追踪

<!-- 遇到的问题记录在此，方便回溯 -->
| 编号 | 任务 | 问题 | 解决方案 | 状态 |
|------|------|------|---------|------|
| - | - | - | - | - |
