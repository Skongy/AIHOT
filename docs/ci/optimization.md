# GitHub Actions 提速与验证

基准提交：`f74ce05`。本次只调整 CI，不合并或部署；实测结果汇总在 [PR #85](https://github.com/Skongy/AIHOT/pull/85)。

## 实际基线

通过 GitHub CLI 获取最近 50 次运行及各 job/step：34 次 Check、16 次 Deploy，共 118 个 job。逐 job 的三段时间保存在 [CSV](baseline-2026-11-01.csv)，原始 JSON/日志保留在本机 `.data/ci-20261101/`。

成功 Check job 的中位数（秒）：

| job | 排队 | 准备 | 测试/校验 | 总执行 | P95 总执行 |
| --- | ---: | ---: | ---: | ---: | ---: |
| check | 2 | 37 | 123 | 161 | 172 |
| web | 2 | 61 | 54 | 119 | 391 |
| docker | 2 | 46 | 3 | 50 | 67 |

排队为 job created→started；准备为执行总时间减去单独可识别的测试、类型和迁移校验步骤，包含构建/缓存/清理；校验为这些步骤的耗时之和，均为 wall-clock，非 CPU 计时。各列分别取中位数，不能直接相加。Deploy 单列保留在 CSV，不混入 Check 对比；它没有单独的测试 step，健康检查内嵌在启用步骤中，不应把该列的 0 解读为没有健康检查。失败、取消、跳过样本仍保留，成功样本统计不隐去原始记录。

最近一次原版 main：[41175276732](https://github.com/Skongy/AIHOT/actions/runs/41175276732)，完整后端 992 项、浏览器 95 项通过，工作流约 172 秒。历史提交的测试规模不完全一致，最终以这次同功能基线和本轮实测共同比较，不用少量新样本宣称稳定 P95。

## 调整

- 后端原生 Node 分片三台 runner，保留全局建库、隔离副本、120s 用例超时和全部测试模式；浏览器两片，继续运行 Chromium、WebKit、双主题和响应式测试。`fail-fast: false`，一片失败不取消其他片的验证。
- Node 参数必须放在文件模式之前；把 `--test-shard` 追加到原 npm test 脚本末尾会被忽略。
- setup-node 内建 npm 缓存，依赖锁文件做键；不缓存 node_modules。Playwright 浏览器按实际版本和操作系统缓存；系统库仍安装核验，缓存命中不能跳过必需 OS 依赖。
- 类型、迁移和前端构建只在 verify 跑一次；同一构建通过一天有效期 artifact 传给浏览器。Docker 仍从源码构建生产镜像，这是包装与运行时校验，不能用前端 artifact 代替。
- 完整冒烟和 MCP 客户端检查集中在 Compose 集成 job。MCP SDK 客户端为开发依赖，必须在 runner 调用生产服务，而不是在已 npm prune 的镜像里调用。
- PostgreSQL 17 客户端优先使用 runner 已有预编译工具，缺少时才从官方 apt 安装，仍检查 dump/restore 版本。
- PR 使用 PR 编号并发组并取消旧运行；main/手动运行使用独立 run_id，避免一个 main 的 pending 运行被另一个 pending 覆盖。
- main 的明确文档位置用 paths-ignore 跳过。PR 工作流始终启动，按整个 PR diff 分类；check/web 为始终执行的汇总门禁，文档 PR 不会 pending。人工触发始终完整检查。
- 只允许 README、docs 和 issue/PR 模板跳过；`industry/prompts/`、`modules/ask/prompts/`、`site/pages/` 等 Markdown 是运行时输入，不能按后缀跳过。

当前仓库无 main 分支保护或 ruleset；本轮不修改保护规则。保留稳定 check/web/docker 状态名，后续设置保护时可直接使用。Deploy 仍要求整个 Check 成功，未降低部署门槛。

## 被实测否定的优化

首轮曾尝试官方 BuildKit GHA `mode=max`，单是缓存导出约 54 秒，反而使 Docker job 达 130 秒，故最终删除这套远端镜像缓存及其试验缓存。保留能带来收益的 npm/浏览器缓存，避免占用 10GB 配额。仓库没有 Go、Rust 或 macOS job，不添加无关缓存与工具链。

本地真实 Docker 连续两次构建：76.7 秒、2.2 秒；依赖 COPY 顺序原本正确，没重写 Dockerfile。生产前端构建连续两次为 3.79 秒、2.88 秒：这不是持久增量构建，但未发现不存在文件的等待；没有为省几秒引入可能返回过期构建的自制缓存。

## 如何复核

```bash
gh run list -R Skongy/AIHOT --limit 50 --json databaseId,name,status,conclusion,createdAt,startedAt,updatedAt
gh api repos/Skongy/AIHOT/actions/runs/<id>/jobs
gh api repos/Skongy/AIHOT/actions/cache/usage
npm run typecheck
node --import ./tests/standalone.ts --test tests/ci-scope.standalone.test.ts
```

合并前确认所有分片总数与原版守恒（允许本轮新增 CI 回归测试）、文档 PR 门禁、连续 push 的旧运行取消，并分别记录冷缓存和热缓存。测试应使用隔离数据库和假服务，不接触生产数据或付费接口。
