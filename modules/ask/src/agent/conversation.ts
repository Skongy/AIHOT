// Short conversation and obvious out-of-scope requests bypass paid calls. Mixed requests do not.
export function conversationAnswer(question: string): string | null {
  const text = question.normalize("NFKC").toLowerCase().replace(/[\s，,。.!！?？、]/g, "");
  // Keep both normal and deep mode inside the product's role. These requests are
  // answered locally so they cannot trigger paid model calls or news searches.
  const asksForCode = /(?:代码|编程|程序|脚本|贪吃蛇|python|javascript|typescript|\bhtml\b|\bcss\b|\bjava\b|\bc\+\+)/i.test(text)
    && /(?:帮我|给我|请|能不能|可以|写|生成|编写|实现|开发|修改|调试|修复|做一个|做个)/i.test(text);
  const asksForOtherDeliverable = /(?:帮我|给我|请|能不能|可以).{0,12}(?:写一篇|写个|写一份|写.{0,4}(?:作文|文章|邮件|简历|论文|周报|报告|文案|诗|小说|故事|剧本|计划|菜谱)|翻译|润色|做作业|做ppt|制作ppt|改简历|写论文|写周报|写报告|写文案|做计划|做菜谱|规划.{0,6}(?:旅游|旅行|行程)|推荐.{0,6}(?:电影|电视剧|歌曲|餐厅)|(?:旅游|旅行|行程|菜谱|股票|基金|星座|健身计划))/i.test(text);
  if (asksForCode || asksForOtherDeliverable) {
    return "我是 GAMEHOT 游戏资讯助手，主要帮你查游戏消息、追踪事件和核对报道。这类非游戏请求不在我的服务范围内；你可以换成游戏资讯、赛事或行业动态相关的问题。";
  }
  const greeting = "(?:你好|您好|嗨|hi|hello|hey)?";
  if (new RegExp(`^${greeting}(?:你是谁|你能(?:做|干)什么|你有什么功能|介绍一下你自己|怎么使用你|深度研究怎么用)$`).test(text)) {
    return "我是 GAMEHOT 游戏资讯助手。你可以让我查游戏新闻、梳理事件进展，或比较不同报道。\n\n- **普通模式**：适合快速查消息、问具体事实、继续追问。\n- **深度模式**：复杂问题会拆成步骤，检索站内资料并核对来源；简单问题仍然直接回答。\n\n例如：‘《无畏契约》最近一周有什么重要变化？’\n\n我使用本站公开资料，不搜索全网；资料不足时会明确说明。";
  }
  if (/^(你好|您好|嗨|hi|hello|hey)$/.test(text)) return "你好！我是 GAMEHOT 游戏资讯助手。你想了解哪款游戏，或哪件事？";
  if (/^(谢谢|谢谢你|多谢|感谢|thanks|thankyou)$/.test(text)) return "不客气！有其他游戏资讯想了解，可以继续问我。";
  return null;
}
