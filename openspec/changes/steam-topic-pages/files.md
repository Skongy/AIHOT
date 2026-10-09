# Files：steam-topic-pages

- `openspec/changes/steam-topic-pages/*`
- `industry/topics.json` — steamAppId
- `packages/backend/src/publication/steam.ts` — 拉取/解析/缓存
- `packages/backend/src/publication/topics.ts` — Topic.steamAppId；loadTopicPage 挂 steam
- `packages/contracts/src/site.ts` — SteamTopicPanel
- `apps/web/app/features/topic/SteamPanel.tsx` — UI
- `apps/web/app/routes/topic.tsx` — 挂载
- `tests/steam-topic.standalone.test.ts`
- `docs/customize.md` — 简述 steamAppId（可选）
