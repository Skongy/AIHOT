import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import type { Screen } from "../../../apps/web/app/components/shell/screens";
import { pageMeta } from "../../../apps/web/app/lib/seo";
import { copyText } from "../../../apps/web/app/lib/clipboard";
import { Answer } from "./answer";
import { useAsk } from "./use-ask";
import { TERMINAL, type Message } from "./types";
import "./ask.css";

export const handle: Screen = { tab: "me", name: "AI 问答" };
export function meta() { return pageMeta({ title: "AI 问答", path: "/ask", description: "快速补课、追踪游戏、看懂事件。基于 GAMEHOT 公开资讯，附报道出处。", noindex: true }); }
const STARTERS = [
  { name: "快速补课", description: "几分钟，抓住游戏圈重点", question: "用一分钟告诉我，最近7天有哪些值得关注的游戏消息？", icon: "brief" },
  { name: "追踪游戏", description: "看看你关心的游戏有何变化", question: "《无畏契约》最近两周有什么重要变化？", icon: "track" },
  { name: "看懂事件", description: "梳理来龙去脉，分清消息出处", question: "最近有哪些游戏热点？帮我梳理一个事件的来龙去脉，并区分官方消息和媒体报道。", icon: "story" },
];
function Glyph({ name, size = 22 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "brief" ? <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h4"/>
      : name === "track" ? <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v4M22 12h-4M12 22v-4M2 12h4"/></>
      : name === "story" ? <><path d="M6 7v10M8 8h5l4 4M8 16h5l4-4"/><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="19" cy="12" r="2"/></>
      : name === "send" ? <path d="M12 19V5M6 11l6-6 6 6"/>
      : name === "plus" ? <path d="M12 5v14M5 12h14"/>
      : <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>}
  </svg>;
}
function ProgressSteps({ steps, streaming }: { steps: NonNullable<Message["steps"]>; streaming: boolean }) {
  const [open, setOpen] = useState(streaming);
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    if (streaming) {
      wasStreaming.current = true;
      setOpen(true);
      return;
    }
    if (!wasStreaming.current) return;
    wasStreaming.current = false;
    const timer = setTimeout(() => setOpen(false), 900);
    return () => clearTimeout(timer);
  }, [streaming]);
  const done = steps.filter((step) => step.status === "ok").length;
  return <section className={`ask-steps${open ? " is-open" : ""}${streaming ? " is-live" : ""}`} aria-label="资料整理过程">
    <button type="button" className="ask-steps-trigger" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span className="ask-steps-heading"><span className="ask-steps-spark" aria-hidden="true"/><span>{streaming ? "正在整理资料" : `资料整理完成 · ${done}/${steps.length}`}</span></span>
      <span className="ask-steps-toggle">{open ? "收起" : "查看过程"}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></span>
    </button>
    <div className="ask-steps-collapse" aria-hidden={!open}><div><ol>{steps.map((step) => <li key={step.stepId}>
      <span className={`ask-step-dot ${step.status}`}/><span className="ask-step-name">{step.labelZh}</span><span className="ask-step-state">{step.status === "running" ? "进行中" : step.status === "ok" ? "完成" : "未完成"}</span>{step.summary && <small>{step.summary}</small>}
    </li>)}</ol></div></div>
  </section>;
}
function AssistantMessage({ message, busy, onPick }: { message: Message; busy: boolean; onPick: (text: string) => void }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const steps = message.steps ?? [];
  const streaming = !!message.status && !TERMINAL.has(message.status) && message.status !== "send_failed";
  const active = steps.filter((s) => s.status === "running");
  const label = active.length ? active.map((s) => s.labelZh).join("、") : steps.length ? "正在整理回答" : message.status === "queued" ? "正在排队" : "正在理解问题";
  return <article className="ask-response" aria-label="助手回答">
    <div className="ask-response-heading"><span className="ask-avatar" aria-hidden="true"><Glyph name="brief" size={17}/></span><span>GAMEHOT</span>{streaming && <span className="ask-progress" role="status"><span className="ask-progress-label">{label}</span><span className="ask-wait-dots" aria-hidden="true"><i/><i/><i/></span></span>}</div>
    {steps.length > 0 && <ProgressSteps steps={steps} streaming={streaming}/>}
    {message.contentInvalidated ? <p className="ask-turn-note">相关来源已不可用，原回答不再展示。</p>
      : message.text ? <Answer text={message.text} evidence={message.evidence ?? []} streaming={streaming}/>
      : <p className="ask-turn-note" role="status">{streaming ? "正在查找站内资料，请稍候。" : message.status === "send_failed" ? "消息未确认送达，可重试发送。" : message.status === "failed" ? "这次未能生成回答，请稍后再试。" : message.status === "cancelled" ? "已停止生成。" : "本次没有生成回答。"}</p>}
    {message.status === "completed_degraded" && <p className="ask-turn-note">部分引用未能关联，请查看原文确认。</p>}
    {message.status === "cancelled" && message.text && <p className="ask-turn-note">已停止，以上为未完成的回答。</p>}
    {message.status === "limit_reached" && <p className="ask-turn-note">已达到本次查询上限，可缩小范围继续提问。</p>}
    {!streaming && message.text && !message.contentInvalidated && <div className="ask-answer-actions">
      <button type="button" onClick={async () => { await copyText(message.text); setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1800); }}><Glyph name="copy" size={14}/>{copied ? "已复制" : "复制回答"}</button>
      {!busy && <button type="button" onClick={() => onPick("请基于刚才的资料，用三句话总结重点，并保留对应来源。")}>用三句话总结</button>}
    </div>}
  </article>;
}
const contextSuffix = /\n\n关于这篇站内资讯：(\/items\/[a-zA-Z0-9_-]+)$/;
// Finish instead of cancel: moving focus away must not start the entrance again.
function finishEntrance(element: HTMLElement) {
  for (const animation of element.getAnimations()) animation.finish();
}
export default function AskPage() {
  const chat = useAsk(); const [params, setParams] = useSearchParams(); const articleId = params.get("article");
  const [context, setContext] = useState<{ id: string; title: string; sourceName: string } | null>(null);
  const [contextLoading, setContextLoading] = useState(false); const [contextError, setContextError] = useState<string | null>(null);
  const [input, setInput] = useState(""); const [showLatest, setShowLatest] = useState(false);
  const [scrollFades, setScrollFades] = useState({ top: false, bottom: false });
  const textarea = useRef<HTMLTextAreaElement>(null); const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(false); const composing = useRef(false); const empty = chat.messages.length === 0;
  const latest = () => {
    const viewport = scroll.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
    setShowLatest(false);
  };
  useEffect(() => {
    const controller = new AbortController(); setContext(null); setContextError(null); setContextLoading(!!articleId);
    if (articleId) void fetch(`/api/ask/context/${encodeURIComponent(articleId)}`, { signal: controller.signal }).then(async (res) => {
      if (!res.ok) throw new Error("这篇资讯已不可用，请移除后重新提问。"); return res.json();
    }).then((data) => { setContext(data); setInput((text) => text || "帮我概括这篇资讯：发生了什么，对玩家有什么影响，哪些信息还不确定？"); })
      .catch((e) => { if (!controller.signal.aborted) setContextError(e.message); }).finally(() => { if (!controller.signal.aborted) setContextLoading(false); });
    return () => controller.abort();
  }, [articleId]);
  useEffect(() => { if (textarea.current) { textarea.current.style.height = "auto"; textarea.current.style.height = `${Math.min(180, Math.max(64, textarea.current.scrollHeight))}px`; } }, [input]);
  useEffect(() => {
    const viewport = scroll.current;
    if (!viewport) return;
    let previous = viewport.scrollTop;
    let touchY = 0;
    let frame = 0;
    const onScroll = () => { const y = viewport.scrollTop; const distance = viewport.scrollHeight - viewport.clientHeight - y; const near = distance <= 8;
      // Input resizing can clamp scrollTop upwards. Only reader gestures pause following.
      if (y > previous && near) follow.current = true;
      previous = y; setShowLatest(!near && !empty);
      setScrollFades((current) => {
        const next = { top: y > 10, bottom: distance > 10 };
        return current.top === next.top && current.bottom === next.bottom ? current : next;
      }); };
    const wheel = (event: WheelEvent) => { if (event.deltaY < 0) follow.current = false; };
    const touchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? 0; };
    const touchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? touchY;
      if (y > touchY) follow.current = false;
      touchY = y;
    };
    const keyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey)) follow.current = false;
    };
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (follow.current) latest(); else onScroll(); });
    });
    resize.observe(viewport);
    onScroll();
    viewport.addEventListener("scroll", onScroll, { passive: true }); viewport.addEventListener("wheel", wheel, { passive: true });
    viewport.addEventListener("touchstart", touchStart, { passive: true }); viewport.addEventListener("touchmove", touchMove, { passive: true });
    viewport.addEventListener("keydown", keyDown);
    return () => {
      resize.disconnect(); cancelAnimationFrame(frame);
      viewport.removeEventListener("scroll", onScroll); viewport.removeEventListener("wheel", wheel);
      viewport.removeEventListener("touchstart", touchStart); viewport.removeEventListener("touchmove", touchMove); viewport.removeEventListener("keydown", keyDown);
    };
  }, [empty]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const viewport = scroll.current;
      if (follow.current) latest();
      else if (viewport) setShowLatest(chat.messages.length > 0 && viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 8);
    });
    return () => cancelAnimationFrame(frame);
  }, [chat.messages]);
  const pick = (text: string) => { setInput(text); textarea.current?.focus({ preventScroll: true }); };
  const clearContext = () => { const next = new URLSearchParams(params); next.delete("article"); setParams(next, { replace: true }); };
  const tooLong = [...(input.trim() + (context ? `\n\n关于这篇站内资讯：/items/${context.id}` : ""))].length > 2000;
  const canSend = chat.available === true && !chat.busy && !chat.restoring && !contextLoading && !contextError && !!input.trim() && !tooLong;
  const submit = async (event?: FormEvent) => {
    event?.preventDefault(); if (!canSend) return;
    const text = input.trim() + (context ? `\n\n关于这篇站内资讯：/items/${context.id}` : ""); setInput(""); follow.current = true; await chat.send(text);
  };
  return <div className={`ask-page${empty ? " is-empty" : ""}`} data-pull-refresh="disabled">
    <header className="ask-page-header"><Link to="/ask" className="ask-page-name">AI 问答</Link><button type="button" className="ask-new-chat" disabled={chat.busy || chat.restoring} onClick={() => { chat.reset(); setInput(""); follow.current = false; }}><Glyph name="plus" size={16}/>新对话</button></header>
    <div className="ask-scroll-frame">
    <div ref={scroll} className="ask-scroll" role="region" aria-label="问答内容" tabIndex={0} onPointerDown={() => { follow.current = false; }}>
    {empty && !chat.restoring && <section className="ask-intro" aria-labelledby="ask-heading"><div className="ask-intro-mark" aria-hidden="true"><span/><span/><span/></div>
      <h1 id="ask-heading"><span className="ask-title-line">游戏圈的消息，</span><span className="ask-title-line">帮你理清楚。</span></h1><p>从一篇报道到一场热议，<br className="ask-phone-break"/>把重点、进展和出处放在一起。</p></section>}
    {chat.restoring && <p className="ask-restore" role="status">正在恢复对话…</p>}
    {!empty && <div className="ask-conversation" aria-label="问答记录"><h1 className="sr-only">AI 问答记录</h1>{chat.messages.map((m, i) => m.role === "user"
      ? <div className="ask-user" key={m.key}><span className="ask-user-label">你</span><p>{m.text.replace(contextSuffix, "")}{m.text.match(contextSuffix)?.[1] && <Link className="ask-user-context" to={m.text.match(contextSuffix)![1]!}>附带资讯</Link>}</p></div>
      : <div key={m.key}><AssistantMessage message={m} busy={chat.busy} onPick={pick}/>{m.status === "send_failed" && <button className="ask-retry" type="button" disabled={chat.busy} onClick={() => { const user = chat.messages[i - 1]; if (user?.requestId) { follow.current = true; void chat.send(user.text, user); } }}>重试发送</button>}</div>)}</div>}
    {empty && !chat.restoring && <section className="ask-starters" aria-label="试试这样问">{STARTERS.map((s) => <button type="button" key={s.name} onFocus={(event) => finishEntrance(event.currentTarget)} onClick={() => pick(s.question)}><span className="ask-starter-icon"><Glyph name={s.icon}/></span><span><strong>{s.name}</strong><small>{s.description}</small></span></button>)}</section>}
    </div>
    <span className={`ask-scroll-fade is-top${scrollFades.top ? " is-visible" : ""}`} aria-hidden="true"/>
    <span className={`ask-scroll-fade is-bottom${scrollFades.bottom ? " is-visible" : ""}`} aria-hidden="true"/>
    </div>
    {!chat.restoring && <div className="ask-composer-area" onFocusCapture={(event) => finishEntrance(event.currentTarget)}>
      {showLatest && <button type="button" className="ask-latest" onClick={() => { follow.current = true; latest(); }}>回到最新回答 ↓</button>}
      {chat.disconnected && <p className="ask-notice" role="status">连接中断，正在恢复。已提交的任务仍会继续，请勿重复发送。</p>}
      {chat.error && <p className="ask-error" role="alert">{chat.error}</p>}
      {chat.available === false && <p className="ask-notice" role="status">问答暂未开放。你仍可<Link to="/">浏览精选</Link>或阅读已有对话。</p>}
      <form className="ask-composer" onSubmit={(event) => void submit(event)}>
        {(context || contextLoading || contextError) && <div className="ask-context"><div><span>正在围绕这篇资讯提问</span><p>{contextLoading ? "正在读取资讯…" : contextError ?? context?.title}</p></div><button type="button" aria-label="移除资讯上下文" onClick={clearContext}>×</button></div>}
        <label htmlFor="ask-input" className="sr-only">你的游戏资讯问题</label>
        <textarea id="ask-input" ref={textarea} value={input} maxLength={2000} rows={2} placeholder={context ? "继续问这篇资讯…" : "想了解哪款游戏，或最近发生了什么？"} onChange={(e) => setInput(e.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !composing.current && e.keyCode !== 229) { e.preventDefault(); if (canSend) void submit(); }
        }} aria-describedby="ask-input-note"/>
        <div className="ask-composer-toolbar"><span id="ask-input-note">{tooLong ? "问题与附带资讯合计不能超过2000字" : chat.busy ? "可以先写下一个问题" : "Enter 发送，Shift + Enter 换行"}</span>{chat.busy ? <button type="button" className="ask-send is-stop" onClick={() => void chat.stop()} aria-label="停止生成"><span/>停止</button> : <button type="submit" className="ask-send" disabled={!canSend} aria-label="发送问题"><Glyph name="send" size={20}/></button>}</div>
      </form>
      <p className="ask-footnote">依据站内公开报道回答，附来源供核对。<span>不搜全网，不提供游戏攻略。</span></p>
    </div>}
  </div>;
}
