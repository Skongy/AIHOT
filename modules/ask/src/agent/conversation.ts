// Only complete, unambiguous conversational turns bypass the model. Mixed requests do not.
export function conversationAnswer(question: string): string | null {
  const text = question.normalize("NFKC").toLowerCase().replace(/[\s，,。.!！?？、]/g, "");
  const greeting = "(?:你好|您好|嗨|hi|hello|hey)?";
  if (new RegExp(`^${greeting}(?:你是谁|你能(?:做|干)什么|你有什么功能|介绍一下你自己|怎么使用你|深度研究怎么用)$`).test(text)) {
    return "我是 GAMEHOT 游戏资讯助手。你可以让我查游戏新闻、梳理事件进展，或比较不同报道。\n\n- **普通模式**：适合快速查消息、问具体事实、继续追问。\n- **深度模式**：复杂问题会拆成步骤，检索站内资料并核对来源；简单问题仍然直接回答。\n\n例如：‘《无畏契约》最近一周有什么重要变化？’\n\n我使用本站公开资料，不搜索全网；资料不足时会明确说明。";
  }
  if (/^(你好|您好|嗨|hi|hello|hey)$/.test(text)) return "你好！我是 GAMEHOT 游戏资讯助手。你想了解哪款游戏，或哪件事？";
  if (/^(谢谢|谢谢你|多谢|感谢|thanks|thankyou)$/.test(text)) return "不客气！有其他游戏资讯想了解，可以继续问我。";
  return null;
}
