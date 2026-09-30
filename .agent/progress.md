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

### [Phase 5] 最终验证总结 — 2026-09-30

**测试**：干净重建（rm -rf dist + build）后全量测试 67 passed（smoke 1 + vault 15 + server 5 + tools 46），零报错零跳过。

**MVP 功能逐条对照（spec 第 3 节）**：
| Fxx | 功能 | 实现工具 | 验证证据 |
|-----|------|---------|---------|
| F01 | vault 浏览 | list_notes | tools.test 7 用例 + server.test 调用；跳过隐藏条目、排序、空目录 `[]` |
| F02 | 读取笔记 | read_note | 逐字一致（含 frontmatter）+ 大小/时间；T010 起实读真实文件 |
| F03 | 搜索笔记 | search_notes | 行级命中 + match_count；大小写/folder/max_results/E09 全覆盖 |
| F04 | 创建笔记 | create_note | 多级父目录自动创建、E03 冲突、overwrite |
| F05 | 编辑笔记 | edit_note | overwrite/append/replace 三模式；E04 防误伤 |
| F06 | 整理笔记 | move_note / delete_note | 重命名/移动/进 .trash/ 全部经真实 stdio 端到端验证 |

**边界与异常逐条对照（spec 第 5 节）**：
| Exx | 期望行为 | 验证 |
|-----|---------|------|
| E01 | 未配置 vault 启动报错退出 | 实测：stderr 提示 + exit=1 |
| E02 | 目标不存在报 not found 不创建 | read/edit/move/delete 各有断言，且 existsSync=false |
| E03 | 已存在默认报错 | create：ALREADY_EXISTS 且原文件不变 |
| E04 | 替换未找到/多处报错且文件不变 | REPLACE_NOT_FOUND / REPLACE_AMBIGUOUS，写盘前抛出 |
| E05 | 路径穿越拒绝 | vault.test 15 用例（`..`/盘符/绝对路径/兜底校验） |
| E06 | 非 .md 拒绝 | resolveMarkdownPath + 各工具用例 |
| E07 | 删除默认进 .trash/ | 同名加时间戳后缀不覆盖；trash 内文件引导 permanent |
| E08 | move 目标冲突报错源不动 | ALREADY_EXISTS，源/目标均原样 |
| E09 | 搜索无匹配返回空列表 | `[]` 非 error |

**端到端**：真实 stdio JSON-RPC（initialize → tools/list → tools/call）验证 7 工具注册与调用；全生命周期演示 create → append → search → move → delete，最终文件落位 `.trash/`，内容完整。注：server 并发处理请求（符合 JSON-RPC/MCP 语义），管道灌入多条消息时后续调用可能先于前者完成，真实 harness 按响应顺序发请求不受影响。

**范围外说明**：CI/CD 与 GitHub 远程仓库不在 MVP（tasks.md 已注明）；如需发布 npm 或推远端，走需求变更流程补充。

**遗留事项**：无。

**状态**：✅ Phase 5 验证通过，MVP 交付完成

### [v1.1] T012 CI 流水线 + T013 GitHub 公开仓库发布 — 2026-09-30

**操作**：
- 需求变更 v1.1（spec 变更记录已追加）：新增 CI 与 GitHub 公开托管，交付管道补齐

**涉及文件**：
- `.github/workflows/ci.yml` — 矩阵 ubuntu-latest/windows-latest × Node 20/24，步骤 npm ci → build → test；windows 位守护 Windows 路径兼容
- `LICENSE` — MIT（Copyright Soleil1043）
- `package.json` — 补 repository/bugs/homepage 元数据
- `README.md` — CI 徽章、git clone 指引

**验证方式**：
- push 后 CI run 36725186510 一次通过，4 个矩阵作业全绿（含 windows-latest × node 20/24，测试中全部 win32 条件用例在真实 Windows runner 上执行）
- 仓库 https://github.com/Soleil1043/obsidian-mcp （PUBLIC，默认分支 main，17 个提交）

**状态**：✅ 通过验证

**Git**：`cc294bb` feat: T012 / T013 提交见仓库

### [T014] etag 并发控制（v1.2） — 2026-09-30

**操作**：
- 新增 etag 模块，4 个写工具接入 if_match 乐观锁（D005 方案），全部校验发生在写盘之前

**涉及文件**：
- `src/etag.ts` — computeEtag（SHA-256/64 hex）+ assertEtagMatches（不符抛 ETAG_MISMATCH，报错含期望/实际 etag 前缀）
- `src/errors.ts` — 错误码新增 ETAG_MISMATCH（E10）
- `src/tools/read.ts` — NoteContent 增加 etag 字段
- `src/tools/create.ts` — if_match：overwrite 时校验当前内容；目标已消失时报 ETAG_MISMATCH；结果增加新内容 etag
- `src/tools/edit.ts` — 读入 current 后即校验 if_match；结果增加编辑后 etag（支持链式编辑）
- `src/tools/organize.ts` — move：读源内容校验 if_match，返回 etag；delete：校验后删除
- `tests/tools.test.ts` — 新增 7 用例（F11/E10）；更新 create/move 两处精确断言以含 etag

**验证方式**：
- `npm run build` 成功；`npm test` 74 passed（smoke 1 + vault 15 + server 5 + tools 53）

**状态**：✅ 通过验证（待用户确认）

**Git**：见下方 T014 commit

### [T015] move_note 更新反向链接（v1.2） — 2026-09-30

**操作**：
- 新增链接解析模块 src/links.ts，move_note 移动后自动维护双向链接

**涉及文件**：
- `src/links.ts` — listVaultNotes（全量 .md 扫描，后续标签/搜索任务复用）；wikilink 解析（路径式/裸文件名唯一解析/歧义/自身锚点，保留 #heading、#^block 与 |alias）；Markdown 相对链接解析（%20 与 <> 解码、目录相对解析、越根拒绝）；fenced code block 内链接不动；rename 时裸链接改写为新名（新名已被占用则退化为全路径）；被移动笔记自身的相对链接按旧目录解析、重写为从新目录出发
- `src/tools/organize.ts` — moveNote 在 rename 前扫描、rename 后改写；返回值新增 updated（被改写文件列表，已排序）与 ambiguous（E11 报告）
- `tests/links.test.ts` — 3 场景：纯移动/重命名/歧义（fixture 见 helpers）
- `tests/helpers.ts` — makeLinksVault / makeLinksVaultAmbiguous / MOVED_NOTE_CONTENT

**验证方式**：
- `npm run build` 成功；`npm test` 77 passed（smoke 1 + vault 15 + server 5 + tools 53 + links 3）
- 首跑抓出 1 个真 bug：重建链接时丢失 `#heading`/`#^block` 锚点——已修复（锚点拆出解析、原样拼回）并补断言

**状态**：✅ 通过验证（待用户确认）

**Git**：见下方 T015 commit

### [T016] manage_frontmatter 工具（v1.2） — 2026-10-01

**操作**：
- 新增 manage_frontmatter 工具（F07），get/set/delete 三动作；依赖决策细化 D007（js-yaml 直用）

**涉及文件**：
- `src/tools/frontmatter.ts` — 自定义定界符切分（无闭合视为普通文本、空 ---/--- 支持、正文字节级保真）；js-yaml load/dump（lineWidth -1 防折行）；get 无 key 返回整个对象 / 带 key 返回 found+value；set 自动创建 frontmatter、支持嵌套值；delete 删到空整块移除；set/delete 支持 if_match；E12 YAML 损坏三类动作均拒绝且不写盘
- `src/errors.ts` — 新错误码 FRONTMATTER_INVALID（E12）、KEY_NOT_FOUND
- `src/server.ts` + `tests/server.test.ts` — 注册第 8 个工具，工具清单断言更新
- `package.json` — 新增 js-yaml ^5（自带类型，@types 冗余已移除）
- `README.md` — 工具表补 manage_frontmatter 行，read/create/edit/move 行补 etag/if_match 说明
- `tests/tools.test.ts` — 新增 9 用例覆盖全部行为

**验证方式**：
- `npm run build` 成功；`npm test` 86 passed（smoke 1 + vault 15 + server 5 + tools 62 + links 3）

**状态**：✅ 通过验证（待用户确认）

**Git**：见下方 T016 commit

### [T017] manage_tags 工具（v1.2） — 2026-10-01

**操作**：
- 新增 manage_tags 工具（F08），list/add/remove 三动作，共 9 个 MCP 工具

**涉及文件**：
- `src/tools/tags.ts` — list：全 vault（folder 可限定）标签统计，frontmatter tags + 行内 #tag 双来源、按笔记去重，计数降序+字典序；行内标签正则带前后边界（不匹配标题/URL 锚点/嵌套父串），跳过代码栅栏，纯数字标签按 Obsidian 规则排除；add：写入 frontmatter tags（无 frontmatter 自动创建；行内已存在报 already_present 不重复写）；remove：frontmatter 与行内一并清除（精确整词、保留嵌套子标签如 #work/sub），删空 frontmatter 整块移除，标签不存在 found=false 不写盘；add/remove 支持 if_match
- `src/tools/frontmatter.ts` — 导出 splitFrontmatter/rebuildFrontmatter/FrontmatterData 供复用
- `src/links.ts` — 导出 splitCodeFences 供复用
- `src/server.ts` + `tests/server.test.ts` + `README.md` — 注册第 9 个工具并同步清单
- `tests/tools.test.ts` — 新增 9 用例；修正 3 处测试断言（scanned 口径、folder 期望、代码块正则误伤）

**验证方式**：
- `npm run build` 成功；`npm test` 95 passed（smoke 1 + vault 15 + server 5 + tools 71 + links 3）

**状态**：✅ 通过验证（待用户确认）

**Git**：见下方 T017 commit

### [T018] create_folder 工具（v1.2） — 2026-10-01

**操作**：
- 新增 create_folder 工具（F09），共 10 个 MCP 工具

**涉及文件**：
- `src/tools/folders.ts` — mkdir recursive 建多级父目录；已存在 → ALREADY_EXISTS、目标为文件 → NOT_A_FILE；空路径/点开头隐藏目录（含路径中间段）→ INVALID_INPUT；越界路径由 vault 校验拒绝
- `src/server.ts` + `tests/server.test.ts` + `README.md` — 注册第 10 个工具并同步清单
- `tests/tools.test.ts` — 新增 4 用例（含 win32 反斜杠条件用例）

**验证方式**：
- `npm run build` 成功；`npm test` 99 passed（smoke 1 + vault 15 + server 5 + tools 75 + links 3）

**状态**：✅ 通过验证（待用户确认）

**Git**：见下方 T018 commit

---

## 问题追踪

<!-- 遇到的问题记录在此，方便回溯 -->
| 编号 | 任务 | 问题 | 解决方案 | 状态 |
|------|------|------|---------|------|
| - | - | - | - | - |
