# Tasks：adopt-openspec-conventions

## 1. 前置（已获批）

- [x] 1.1 用户批准同步 fork（Q0-1）
- [x] 1.2 同步：`gh repo sync Skongy/AIHOT --source KKKKhazix/AIHOT -b main`（9848e93 → 07d4c77，快进）；本地 main 已和上游一致

## 2. 本机环境（只动本机，不动仓库）

- [x] 2.1 `npm i -g @fission-ai/openspec@latest`（1.14.1，Node ≥ 20.19 即可）
- [x] 2.2 关闭遥测：`openspec config set telemetry.enabled false` / `OPENSPEC_TELEMETRY=0`
- [x] 2.3 安装 Node 24.11+（v24.21.0，用户级）

## 3. 初始化（分支 `openspec/adopt-conventions`）

- [x] 3.1 `openspec init --tools none --language zh-CN --no-animation`（只生成 openspec/）
- [x] 3.2 把 `openspec/config.yaml` 换成项目约定
- [x] 3.3 放入 `openspec/changes/retarget-game-news/`（变更 1 草案，待批）
- [x] 3.4 `openspec validate --all --strict` 通过

## 4. 验证与交付

- [x] 4.1 `git status` 只多出 `openspec/`，没有改任何已有文件
- [x] 4.2 用户审阅并合并 PR #1；随后 `openspec archive adopt-openspec-conventions`
