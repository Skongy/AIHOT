# GAMEHOT 新闻正文

按站点所有者的展示要求，当前启用的编辑型新闻信源在 `industry/sources.json` 中开启 `site_fulltext`，并配置 `fetchPublicContent: true`，让采集处理队列取回文章页正文。站内详情保留 AI 导读，正文使用已确认并清理后的原文 HTML；英文来源有译文时沿用中英切换。抓取失败或正文未确认时给出明确的原文入口，不用 AI 摘要充当正文。单篇 `summary-only` / 撤回状态仍由已有发布规则处理。

`syndicate_fulltext` 保持原配置，站内展示与 RSS 等出口的全文分发分别控制。新增信源仍使用框架默认值，按站点需要逐项配置。

上线时注意：seed 不覆盖已存在的信源。需要将本次启用的新闻信源的 `site_fulltext` 和 `config.fetchPublicContent` 同步到线上数据库，再调用 `republishSource` 重建已有文章的公开投影（不调用模型）。对于缺少正文的文章，通过既有正文提取队列补取；提取到新正文会按现有版本机制重新分析，仍经过回执与预算限制。
