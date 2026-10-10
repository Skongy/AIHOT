## 1. 规格与基线

- [x] 1.1 写 proposal / tasks / spec 增量
- [x] 1.2 确认只用 json_list + hot_signal，不接微博

## 2. 信源

- [x] 2.1 加入 B 站热搜、贴吧热议两条 `hot_signal` 源与夹具
- [x] 2.2 更新 `game-sources.standalone.test.ts`

## 3. 匹配

- [x] 3.1 `groupSignal`/`rematchSignals` 无向量时用字面匹配 + 种子共现
- [x] 3.2 挂不上已有事件则 unmatched，不建热点

## 4. 验证与交付

- [x] 4.1 typecheck / 相关 standalone 测试
- [x] 4.2 中文 PR、合并、删分支
