# 任务清单 (Tasks)

> Phase 3 产出。基于 plan.md 拆解，用户确认后进入 Phase 4 逐个执行。
> 规则：1 个任务 = 1 个可独立验证的功能点 | 严格按顺序执行 | 不跳依赖 | 每个任务标注覆盖的需求编号
> 说明：测试随各功能任务一起交付（每任务自带 vitest 用例），不设独立测试任务；模板中的 CI/CD 任务不在 MVP 范围，如需可走需求变更流程补充。

---

## 任务列表

<!-- 基础设施层 -->
- [x] T001: 项目初始化与构建骨架 | 依赖: 无 | 涉及文件: package.json, tsconfig.json, vitest.config.ts, .gitignore, src/index.ts（占位） | 验收: `npm install && npm run build` 成功，`npm test` 跑通冒烟测试 | 覆盖: 无（基础设施）
- [x] T002: Vault 核心与路径安全 | 依赖: T001 | 涉及文件: src/errors.ts, src/vault.ts, tests/vault.test.ts | 验收: `npm test` 全绿——根路径取自 OBSIDIAN_VAULT_PATH；POSIX 相对路径归一化；`..`/绝对路径逃逸拒绝（E05）；非 `.md` 目标拒绝（E06） | 覆盖: E05, E06

<!-- 核心工具层（读） -->
- [x] T003: list_notes 工具 | 依赖: T002 | 涉及文件: src/tools/list.ts, tests/tools.test.ts | 验收: `npm test`——fixture vault 返回 `.md` 文件与子文件夹；跳过 `.obsidian/`、`.trash/`；空目录返回 `[]` | 覆盖: F01
- [x] T004: read_note 工具 | 依赖: T002 | 涉及文件: src/tools/read.ts, tests/tools.test.ts | 验收: `npm test`——返回内容与磁盘逐字一致（含 frontmatter）；文件不存在时报 not found 且不创建文件（E02） | 覆盖: F02, E02
- [x] T005: search_notes 工具 | 依赖: T002 | 涉及文件: src/tools/search.ts, tests/tools.test.ts | 验收: `npm test`——返回 path/line_number/line_text/match_count；默认大小写不敏感；`folder` 限定生效；无匹配返回空列表（E09）；`max_results` 截断生效 | 覆盖: F03, E09

<!-- 核心工具层（写） -->
- [x] T006: create_note 工具 | 依赖: T002 | 涉及文件: src/tools/create.ts, tests/tools.test.ts | 验收: `npm test`——创建成功且父目录自动创建；已存在时报错（E03）；`overwrite=true` 覆盖成功 | 覆盖: F04, E03
- [x] T007: edit_note 工具 | 依赖: T002 | 涉及文件: src/tools/edit.ts, tests/tools.test.ts | 验收: `npm test`——overwrite/append/replace 三模式行为正确；replace 未找到或多处匹配时报错且文件不变（E04）；`replace_all=true` 全部替换 | 覆盖: F05, E04
- [x] T008: move_note 工具 | 依赖: T002 | 涉及文件: src/tools/organize.ts, tests/tools.test.ts | 验收: `npm test`——重命名/移动后旧路径不存在、新路径内容一致；目标已存在时报错且原文件保持原位（E08） | 覆盖: F06, E08
- [x] T009: delete_note 工具 | 依赖: T002 | 涉及文件: src/tools/organize.ts, tests/tools.test.ts | 验收: `npm test`——默认移入 vault 根 `.trash/`（同名自动加后缀）；`permanent=true` 永久删除 | 覆盖: F06, E07

<!-- 装配与交付 -->
- [x] T010: MCP server 装配与 stdio 入口 | 依赖: T003, T004, T005, T006, T007, T008, T009 | 涉及文件: src/server.ts, src/index.ts, package.json（bin 字段） | 验收: 设置 OBSIDIAN_VAULT_PATH 后 `npm run build` 并用 MCP Inspector（`npx @modelcontextprotocol/inspector node dist/index.js`）连接成功、列出 7 个工具并可调用；未设置变量时启动即报错退出（E01） | 覆盖: E01 + F01-F06（装配）
- [x] T011: README 使用文档 | 依赖: T010 | 涉及文件: README.md | 验收: 按文档可独立完成安装与配置——含 harness 配置 JSON 示例、环境变量说明、工具清单 | 覆盖: 无（交付文档）
- [x] T012: CI 流水线配置 | 依赖: T011 | 涉及文件: .github/workflows/ci.yml, README.md | 验收: push 后 GitHub Actions 自动跑 `npm ci && npm run build && npm test`，ubuntu/windows × node 20/24 矩阵全绿；README 加徽章 | 覆盖: 无（基础设施）
- [x] T013: GitHub 公开仓库发布 | 依赖: T012 | 涉及文件: LICENSE, package.json, README.md | 验收: 公开仓库 Soleil1043/obsidian-mcp 存在，含全部提交，CI 运行全绿 | 覆盖: 无（基础设施）

---

## 覆盖检查（Phase 3 门禁，用户确认前逐项自查）

- [x] 每条 Fxx 至少被一个任务覆盖：F01→T003，F02→T004，F03→T005，F04→T006，F05→T007，F06→T008/T009
- [x] 每条 Exx 有对应的校验或测试任务：E01→T010，E02→T004，E03→T006，E04→T007，E05/E06→T002，E07→T009，E08→T008，E09→T005
- [x] 不存在既不覆盖需求、也不属于基础设施的任务：T001（基础设施）、T011（交付文档）外全部绑定 Fxx/Exx

---

## 进度统计

- 总任务数：13
- 已完成：13
- 进行中：0
- 待开始：0
