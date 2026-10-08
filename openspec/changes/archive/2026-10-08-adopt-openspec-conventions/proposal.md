# Proposal：变更 0 —— 引入 OpenSpec 与项目约定（adopt-openspec-conventions）

> 状态：用户已于 2026-10-08 批准（含同步 fork）。

## Why

用户要求先规格后代码，每个计划都要本人批准；仓库里此前没有 OpenSpec 目录和项目约定。另外 fork 原先落后上游 45 个提交（领先 0），后续计划都以上游最新代码为准，所以要先同步。

## What Changes

- （已获批的外部操作）把 Skongy/AIHOT 的 main 快进到 KKKKhazix/AIHOT 的 main（07d4c77）：`gh repo sync Skongy/AIHOT --source KKKKhazix/AIHOT -b main`
- 用 `OPENSPEC_TELEMETRY=0 openspec init --tools none --language zh-CN` 初始化，**只新增 `openspec/` 目录**：
  - `openspec/config.yaml`：替换成本项目的约定（项目背景、四栏目定位、先规格后代码、与上游可合并的规则、验证命令）
  - `openspec/specs/.gitkeep`（specs 随每个变更 archive 积累，不写基线 spec）
  - `openspec/changes/archive/.gitkeep`
  - `openspec/changes/adopt-openspec-conventions/`（本变更）和 `openspec/changes/retarget-game-news/`（变更 1 草案，待批）
- 不生成任何 AI 工具的指令或技能目录（不生成 `.claude/commands`、`.claude/skills`、`.agents/` 等）
- 不改 `AGENTS.md`、`CLAUDE.md` 或任何已有文件

## Capabilities

### New Capabilities
（无。本变更只涉及工具和流程，不改系统行为，`.openspec.yaml` 设了 `skip_specs: true`。）

### Modified Capabilities
（无）

## Impact

- 只新增 `openspec/` 目录，运行时、依赖、数据库、应用代码都不受影响
- 本机（box）已全局安装 `@fission-ai/openspec` 1.14.1，并关闭遥测

## Out of Scope

- 不改任何业务代码、配置或提示词
- 不补写现有系统的基线 specs

## 已决定的问题

- Q0-1：同步 fork —— 已批准并执行（快进）
- Q0-2：不生成按工具区分的命令和技能目录，只要 `openspec/`
- Q0-3：specs 随每个变更逐步积累，不写基线 spec
- Q0-4：不改 AGENTS.md，也不改其他任何已有文件
