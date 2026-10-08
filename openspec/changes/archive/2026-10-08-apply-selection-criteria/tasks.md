# Tasks：apply-selection-criteria

> 状态：进行中。Steam 焦点配置已改；提示词草稿待审；日报引擎补丁与 LLM 校准未做。

## 0. Steam 焦点配置（本轮）

- [x] 0.1 `topics.json` 改为四款 Steam 种子主题；taxonomy 补实体
- [x] 0.2 停用手游/F2P 官源与 LoL Esports；新增四款 Steam news RSS；试抓 OK
- [x] 0.3 提示词草稿写入 `/workspace/aihot-plan/prompts-draft/`（含三者任一精选口径）
- [x] 0.4 相关配置测试更新并通过
- [x] 0.5 提示词草稿已写入 `industry/prompts/`（文件名未改）

## 1. 前置与基线

- [x] 1.1 变更 ①（connect-game-sources）已合并并归档
- [ ] 1.2 部署环境已配置 LLM key；本机测试用的 key 只放在环境变量里，不写进仓库
- [ ] 1.3 用户已答复 Q3-0 ~ Q3-6
- [ ] 1.4 基线：typecheck / 全量测试 / web 测试通过

## 2. 校准样本

- [ ] 2.1 用户确认 `calibration-sample.json` 的 30 条预标注
- [ ] 2.2 从开发库按信源与排除类型分层再抽 70–170 条，用户标注 select/reject/either
- [ ] 2.3 转成 `.data/gold.jsonl`（7:3 开发/留出），不进 Git
- [ ] 2.4 跑基线：`eval-selection --label "v0 占位提示词"`，记录查准率/查全率/门槛扫描

## 3. 提示词（配置）

- [x] 3.1 `selection-score.md`：读者画像加“玩/买/等”与 Steam 焦点；精选口径为三者任一；`reson`/`cred` 与纳入/排除清单（草稿已写，待审后落库）
- [x] 3.2 `prefilter.md`：按 Q3-2 加纯广告 BLOCK 一条（不加则跳过）
- [x] 3.3 `content-understanding.md`、`summarize-article.md`、`summarize-long-post.md`：传闻标注规则；推荐理由写对玩/买/等的影响
- [ ] 3.4 `structure.md`：传闻 fact 的主体与动作；按 Q3-4 增加 `upcoming` 字段说明
- [ ] 3.5 提示词渲染测试：排除项与传闻规则文本出现在渲染结果里

## 4. 校准与门槛

- [ ] 4.1 跑 `eval-selection --label "v1 灵感标准"`（开发集），在 SelectBench 看错例，改提示词，最多迭代 3 轮
- [ ] 4.2 按门槛扫描结果提出 `industry/selection.ts` 新门槛，**由用户拍板**后再改
- [ ] 4.3 跑留出集确认；对比预筛与类别标注（SQL）
- [ ] 4.4 把每轮结果（标签、指标、改动摘要）记到本变更的 design.md 末尾“校准记录”

## 5. 日报结构（引擎补丁）

- [x] 5.1 `site/site.ts` 加 `REPORTS.dailyLayout.sectionQuotas`（默认不设时保持上游行为）
- [x] 5.2 `reports/edition.ts`：`arrangeDaily` 支持类别下限/上限；单测覆盖“不够不硬凑”“超上限进快讯”
- [x] 5.3 `reports/compose.ts`：一句话头条；（Q3-4 选做时）`watchlist` 计算
- [x] 5.4 `editorial/analyze.ts`（upcoming） 的 `StructureSchema` 加可选 `upcoming`；`.catch` 兜底，旧数据无此字段不报错
- [x] 5.5 `packages/contracts` + ReportPaper 明日关注 日报类型加可选 `watchlist`；`apps/web/app/features/report/ReportPaper.tsx` 渲染明日关注与每条来源名
- [ ] 5.6 在开发库重生成最近一期日报，人工检查结构

## 6. 验证与交付

- [ ] 6.1 `npm run typecheck`；`DATABASE_URL=…/_test npm test`；`npm run build -w @aihot/web && node --test apps/web/tests/*.test.ts`；`node scripts/smoke.ts --base http://localhost:3000`
- [ ] 6.2 files.md 列出全部引擎补丁
- [ ] 6.3 配置提交可推送；**提示词落库与引擎补丁完成前不开 PR**；合并后归档
