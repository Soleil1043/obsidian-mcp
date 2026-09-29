# obsidian-mcp — Agent 工作规则

> 本文件是 Agent 的全局指令。不同 Harness 会自动读取项目根目录的规则文件：
> TRAE / Claude Code → `AGENTS.md` / `CLAUDE.md` | Cursor → `.cursor/rules/*.mdc` | Windsurf → `.windsurfrules` | Cline → `.clinerules`
> 如果切换 Harness，将本文件内容复制到对应文件即可。

---

## 1. 工作流约束（强制）

1. **启动时恢复上下文**：每次对话开始，先读取 `.agent/` 目录下所有 `.md` 文件，理解当前项目状态
2. **按清单执行**：严格按 `.agent/tasks.md` 中的任务顺序执行，不跳依赖，不一次做多个任务
3. **完成即记录**：每完成一个任务，必须执行以下 4 步：
   - 在 `tasks.md` 中将对应项标记为 `[x]`
   - 在 `progress.md` 中追加构建记录
   - 单独 git commit
   - 提示用户验证，等待确认后再做下一个
4. **决策留痕**：遇到需要决策的技术选型，先写入 `decisions.md`（说明选项和理由），再继续
5. **不超前实现**：只实现当前任务，不做"顺便"的额外功能
6. **不删不改状态文件的历史记录**：`progress.md` 和 `decisions.md` 只追加不删除
7. **需求变更走修订**：构建中要改功能，先用 `prompts.md` 的「需求变更 Prompt」修订 `spec.md` 并记录变更，同步 plan/tasks 后才改代码，不直接改实现

## 2. 技术栈

- 语言：TypeScript 5.x（strict 模式），Node.js ≥ 20
- 框架：@modelcontextprotocol/sdk（MCP 官方 TypeScript SDK），stdio transport
- 数据库：无——直接读写 Obsidian vault 文件系统（Markdown 纯文本）
- 缓存：无
- 包管理：npm
- 测试：vitest

## 3. 代码约定

- 所有函数加类型注解，开启 TypeScript strict
- MCP 工具与参数命名使用 snake_case，工具名动词开头（如 `read_note`、`create_note`）
- vault 根路径通过环境变量 `OBSIDIAN_VAULT_PATH` 读取，不硬编码
- 所有文件操作必须限制在 vault 根目录内，拒绝路径穿越（`..`、绝对路径逃逸）
- 每个模块有清晰的单一职责
- 错误处理只在系统边界（MCP 工具入口、文件系统调用），内部代码信任框架 guarantee

## 4. Git 规范

- 每个任务一个 commit：`feat: T0XX [任务简述]`
- 修复 commit：`fix: T0XX [问题描述]`
- 文档 commit：`docs: [内容]`
- 不使用 `--no-verify` 跳过 hook
- 不使用 `git add -A`，按文件添加

## 5. 文件结构约定

```
.agent/          ← 项目状态（Agent 读写，不删除）
  spec.md        ← Phase 1: 需求文档
  plan.md        ← Phase 2: 技术方案
  tasks.md       ← Phase 3: 任务清单
  progress.md    ← Phase 4: 构建日志
  decisions.md   ← 全程: 决策记录
  prompts.md     ← Prompt 模板参考
src/             ← 实际代码
tests/           ← 测试代码
```
