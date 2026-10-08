# Tasks：connect-game-sources

> 状态：已实施。用户批准本变更并采纳 design.md 的默认值后，在分支 `change/connect-game-sources` 上完成了以下任务。

## 1. 前置与基线

- [x] 1.1 变更 1（retarget-game-news）已合并到 main，`openspec/specs/source-seeding` 存在；本分支基于含 specs 的 tip（`e0bf26a`）
- [x] 1.2 用户批准并采纳 Q2-1～Q2-5 默认值；官方名单另见 `/workspace/gamehot/sources-official-v1.md`
- [x] 1.3 基线：typecheck、backend、standalone、web 测试均通过；`COLLECT_ENABLED` / `MODEL_CALLS_ENABLED` 保持 false

## 2. 写入信源配置

- [x] 2.1 填写 `industry/sources.json`：媒体 16 + 官方 15，全部 editorial、不展示全文、回填 8 条 / 1 个月
- [x] 2.2 机核：deny `/radios/`，allow `/articles/`
- [x] 2.3 巴哈姆特：`ingestNoiseFilter.dropMarkersTitleOnly` 去掉动画 / 电影 / 轻小说
- [x] 2.4 IGN中国：按 Q2-2 照常收；地址改成 `https://www.ign.com.cn/feed.xml`（绕开 `/rss` → http 的 301）
- [x] 2.5 游民星空 / 3DM / A9VG / 17173 / 新浪电竞 / 玩加电竞 / 游戏陀螺 / indienova / 国家新闻出版署：选择器、前缀、需要时配 `detail`
- [x] 2.6 官方 15 个：王者 / 英雄联盟 / 原神 / 星铁（json_list）、永劫无间 / 和平精英 / LoL Esports / 任天堂香港（web_list）、其余 7 个 RSS；单款游戏源加标题规则；owner_entity_id 对应 ENTITIES
- [x] 2.7 英雄联盟接口用 `r0=json`（现有 json_list 不拆 JSONP）；永劫无间用官网首页（`/news/official/` 目录 404）；国家新闻出版署用国产子页；Steam 商店新闻给 T1_5；indienova 默认停用
- [x] 2.8 `industry/prompts/rules-domain.md` 加第 6 条：繁体和外文输出简体中文

## 3. 测试与快照

- [x] 3.1 保存 31 个列表页 + 5 个文章页快照到 `tests/fixtures/game-sources/`（删减方式：去掉 script / style / svg 和无关属性，RSS 只留前几条、正文截短；结构化数据和日期 meta 保留）
- [x] 3.2 新增 `tests/game-sources.standalone.test.ts`：配置合法性、标题规则、噪声过滤、快照解析、文章页补日期（40 个用例全过）
- [x] 3.3 `node scripts/seed.ts` 在空库上导入 31 个源（30 启用 + 1 停用），再跑一次 0 新增

## 4. 人工试抓（不调模型）

- [x] 4.1 每个源读一次列表（`ALLOW_PRIVATE_NETWORK_FETCH=true`，本机 egress 用 198.18.0.0/15 伪地址；`MODEL_CALLS_ENABLED=false`），结果见 `/workspace/aihot-plan/trial-fetch-2026-10-08.json`
- [x] 4.2 首次失败并已修正：IGN中国（301 到 http）、任天堂香港（跳转到 `nintendo.com/hk`）。其余 29 个一次成功。标题规则实测：王者 15→8、英雄联盟 16→6、原神 20→6、星铁 20→12、永劫 18→11、和平精英 26→21
- [x] 4.3 `COLLECT_ENABLED` 保持 false（本机试抓用的是预览路径，没有写库）

## 5. 验证与交付

- [x] 5.1 `npm run typecheck`；`DATABASE_URL=…/aihot_test npm test`（714 通过）；`npm run test:standalone`（201 通过）；`npm run build -w @aihot/web && node --test apps/web/tests/*.test.ts`（44 通过）；空库起三个进程 + `node scripts/smoke.ts` 全过；`OPENSPEC_TELEMETRY=0 openspec validate --all --strict` 通过
- [x] 5.2 本文件全部勾完；PR 说明见 PR 正文
- [x] 5.3 提交、推送、开 PR（用户明确要求）；不合并，合并后由用户触发归档
