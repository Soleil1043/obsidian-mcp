# 决策记录 (Decisions)

> 全程产出。遇到需要决策的技术选型、架构取舍，记录在此，只追加不删除。
> 格式：编号 | 日期 | 决策内容 | 选项对比 | 最终选择 | 理由

---

## 决策条目

<!-- 每条记录格式：
## D0XX: [决策标题] — YYYY-MM-DD

**背景**：
[为什么需要做这个决策]

**选项**：
| 选项 | 优点 | 缺点 |
|------|------|------|
| A: [选项A] | [优点] | [缺点] |
| B: [选项B] | [优点] | [缺点] |

**最终选择**：[选项X]

**理由**：
[1-2 句话说明为什么选这个]

**影响**：
[这个决策影响哪些模块/任务]
-->

## D001: 技术栈与 vault 接入方式 — 2026-09-30

**背景**：
初始化 obsidian-mcp 项目，需确定 MCP server 的实现语言，以及访问 Obsidian vault 的方式（该决策决定整体架构与部署前提）。

**选项**：
| 选项 | 优点 | 缺点 |
|------|------|------|
| A: TypeScript + Node，直接文件系统访问 | MCP 官方 TS SDK 最成熟；无需 Obsidian 运行，实现简单可靠；npx/npm 分发即用 | 拿不到 Obsidian 运行时状态（如当前打开的文件、插件数据） |
| B: TypeScript + Node，经 Local REST API 插件 | 可获取活动文件等实时状态 | 需 Obsidian 常驻运行并安装第三方插件，部署门槛高 |
| C: Python + FastMCP，直接文件系统 | 生态成熟，用户可能更熟 Python | 分发需 uvx/Python 环境；TS SDK 生态对 MCP 支持更领先 |

**最终选择**：选项 A（TypeScript + Node，直接文件系统访问 vault）

**理由**：
MVP 目标是文档的浏览/搜索/写入/整理，全部可通过文件系统完成；TS 官方 SDK 成熟且 harness 配置最简单。运行时状态非 MVP 需求。

**影响**：
全项目。transport 固定为 stdio；vault 根路径经 `OBSIDIAN_VAULT_PATH` 环境变量配置；文件操作需做路径穿越防护。

## D002: MCP 工具粒度 — 2026-09-30

**背景**：
plan.md 工具层设计需决定对外暴露 1 个带 action 参数的大工具，还是多个细粒度工具。

**选项**：
| 选项 | 优点 | 缺点 |
|------|------|------|
| A: 7 个细粒度工具 | schema 简单、描述明确，LLM 调用成功率高 | 工具数量多，注册代码略多 |
| B: 1 个大工具 + action 参数 | 工具列表短 | 单个 schema 复杂、参数间条件依赖多，LLM 易误用 |

**最终选择**：选项 A（仅 `edit_note` 内部合并 overwrite/append/replace 三模式，因其参数高度重叠）

**理由**：
MCP 工具的消费者是 LLM，schema 越简单调用越可靠；工具数量 7 个在可读范围内。

**影响**：
src/tools/ 按工具一文件组织；plan.md 第 4 节工具表。

## D003: 删除策略默认进 .trash/ — 2026-09-30

**背景**：
spec E07 要求删除不可静默永久丢失，需选 trash 实现方式。

**选项**：
| 选项 | 优点 | 缺点 |
|------|------|------|
| A: 移入 vault 根 `.trash/` | Obsidian 原生约定，纯文件操作，跨平台一致 | 占用 vault 内空间（可手动清理） |
| B: 移入系统回收站 | 用户熟悉 | 各平台 API 不一致，需额外原生依赖 |

**最终选择**：选项 A，另提供 `permanent=true` 显式永久删除

**理由**：
`.trash/` 是 Obsidian 用户可识别、可在应用内恢复的位置；实现保持纯 Node 文件操作。

**影响**：
delete_note 工具（A07）；`list_notes`/`search_notes` 默认跳过 `.trash/` 与 `.obsidian/`。

## D005: 并发控制采用 etag + if_match 乐观锁 — 2026-09-30

**背景**：
v1.2 竞品调研发现：多个 harness 并发写同一笔记会互相覆盖（丢更新）。需选并发控制机制。

**选项**：
| 选项 | 优点 | 缺点 |
|------|------|------|
| A: 内容 etag（SHA-256）+ `if_match` 乐观锁 | 无锁文件残留、跨平台、与 HTTP ETag 语义一致；StevenStavrakis/obsidian-mcp 同方案已验证可行 | 调用方需两步（先读后写），LLM 可能忘传 if_match（可选参数保持向后兼容） |
| B: 文件锁（flock/lockfile） | 强互斥 | Windows/POSIX 行为不一致，崩溃后残留死锁文件，MCP 无会话边界可释放 |
| C: 维持现状（后写覆盖） | 零成本 | 正确性硬伤 |

**最终选择**：选项 A

**理由**：
个人 vault 场景并发冲突低频，乐观锁足够；兼容性最好且不引入跨平台锁问题。`if_match` 设为可选，旧调用方式不受影响。

**影响**：
read_note 返回 etag；edit/create/move/delete 新增 if_match 与 ETAG_MISMATCH 错误码（T014）。

## D006: frontmatter 解析采用 gray-matter — 2026-09-30

**背景**：
F07/F08 需要解析与序列化 YAML frontmatter，需选实现方式。

**选项**：
| 选项 | 优点 | 缺点 |
|------|------|------|
| A: gray-matter | Obsidian 生态事实标准，正确处理嵌套/引号/多行/日期等 YAML 边界 | 新增一个依赖 |
| B: 手写正则 + 简易解析 | 零依赖 | YAML 边界情况多，极易写坏用户 frontmatter（E12 风险） |
| C: yaml 包 + 手工切分 frontmatter | 解析器成熟 | 切分/拼接逻辑仍需自写且要两端（解析+序列化）保持一致 |

**最终选择**：选项 A

**理由**：
frontmatter 写坏是数据损坏级风险（E12），成熟库显著降低风险；gray-matter 同时提供解析与 stringify，两端一致。

**影响**：
manage_frontmatter / manage_tags 工具；package.json 依赖；E12 行为。

## D007: frontmatter 实施细化——直接使用 js-yaml 而非 gray-matter — 2026-10-01

**背景**：
T016 实施时发现 gray-matter 的 stringify 无法保证正文字节级保真（E12 要求 set/delete 后正文逐字节不变），且定界符切分需按 Obsidian 语义自定义（无闭合定界符视为普通文本）。

**选项**：
| 选项 | 优点 | 缺点 |
|------|------|------|
| A: js-yaml 直接 load/dump + 自定义定界符切分 | 正文保真可控；解析/序列化两端同引擎一致；少一层包装依赖 | 切分逻辑自担（约 30 行，已测试覆盖） |
| B: 维持 gray-matter | 与 D006 字面一致 | stringify 的定界符/换行行为不受控，正文件保真无保证 |

**最终选择**：选项 A（js-yaml 是 gray-matter 的底层引擎，D006 的"成熟解析器"意图不变）

**理由**：
E12 的数据保真是硬约束，工具层需要完全控制文本重组；两端同用 js-yaml 保持一致性。

**影响**：
package.json 依赖为 js-yaml ^5（自带类型，无需 @types）；src/tools/frontmatter.ts 的 splitFrontmatter。

## D004: 搜索用同步遍历而非索引 — 2026-09-30

**背景**：
search_notes（F03）的实现方式选型。

**选项**：
| 选项 | 优点 | 缺点 |
|------|------|------|
| A: 同步遍历 + 逐行匹配 | 零依赖、实现简单、结果实时 | 超大 vault（数万文件）会慢 |
| B: 建立倒排索引 | 大 vault 查询快 | 需维护索引一致性，MVP 复杂度过高 |

**最终选择**：选项 A，默认排除 `.obsidian/`、`.trash/`，`max_results` 上限防失控

**理由**：
MVP 目标是个人 vault（数千文件内），遍历耗时可接受；YAGNI。

**影响**：
search_notes 工具（A03）；性能预期写入工具描述。
