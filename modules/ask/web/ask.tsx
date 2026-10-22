import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { beijingDate, beijingTime } from "@aihot/contracts/time";
import { Link, useSearchParams } from "react-router";
import type { Screen } from "../../../apps/web/app/components/shell/screens";
import { pageMeta } from "../../../apps/web/app/lib/seo";
import { copyText } from "../../../apps/web/app/lib/clipboard";
import { Answer } from "./answer";
import { DEEP_STARTERS, STARTERS } from "./starters";
import { useAsk } from "./use-ask";
import { TERMINAL, type AskMode, type Message, type ResearchReportView } from "./types";
import "./ask.css";

export const handle: Screen = { tab: "me", name: "AI 问答" };
export function meta() { return pageMeta({ title: "AI 问答", path: "/ask", description: "快速补课、追踪游戏、看懂事件。基于 GAMEHOT 公开资讯，附报道出处。", noindex: true }); }
const RESEARCH_STATUS = { pending: "等待", running: "进行中", done: "完成", skipped: "跳过", failed: "未完成" } as const;
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
function ResearchProcess({ plan, streaming }: { plan: NonNullable<Message["plan"]>; streaming: boolean }) {
  const done = plan.steps.filter((step) => step.status === "done" || step.status === "skipped").length;
  return <section className={`ask-research${streaming ? " is-live" : ""}`} aria-label="研究过程">
    <div className="ask-research-head"><span>研究计划 · 第 {plan.version} 版</span><span>{done}/{plan.steps.length}</span></div>
    <ol>{plan.steps.map((step) => <li key={step.index} className={step.status === "running" ? "is-current" : ""} aria-current={step.status === "running" ? "step" : undefined}>
      <span className={`ask-step-dot ${step.status === "done" || step.status === "skipped" ? "ok" : step.status === "failed" ? "fail" : step.status}`}/>
      <div><p className="ask-research-goal">{step.goal}</p><p className="ask-research-meta">{RESEARCH_STATUS[step.status]}{step.toolLabel ? ` · ${step.toolLabel}` : ""}{step.summary ? ` · ${step.summary}` : ""}</p></div>
    </li>)}</ol>
  </section>;
}
function clockLabel(at: string): string {
  return `${beijingDate(at)} ${beijingTime(at)}`;
}
function ReportView({ report }: { report: ResearchReportView }) {
  const max = report.chart ? Math.max(...report.chart.map((point) => point.value), 1) : 1;
  const reported = report.reported ?? [];
  const cited = report.coverage.cited ?? report.citations.length;
  return <div className="ask-report">
    {report.lead && <p>{report.lead}</p>}
    <section>
      <h3>核心结论</h3>
      {report.summary.length ? <ul>{report.summary.map((line) => <li key={line}>{line}</li>)}</ul> : <p>目前没有足够证据支持结论。</p>}
    </section>
    {report.showTimeline !== false && report.timeline.length > 0 && <section>
      <h3>报道时间</h3>
      <ol className="ask-report-timeline">
        {report.timeline.map((item) => <li key={`verified-${item.evidenceId}-${item.at}`}>
          <time dateTime={item.at}>报道发布 {clockLabel(item.at)}</time>
          <span>{item.title}</span>
          <small>{item.credibility ?? "来源支持"} · [{item.evidenceId}] · {item.sourceType}{item.timelineAt ? ` · 站内时间 ${clockLabel(item.timelineAt)}` : ""}{item.mentioned ? ` · 报道中写到 ${item.mentioned}，这不是报道发布时间` : ""}</small>
        </li>)}
      </ol>
    </section>}
    {report.showCoverage !== false && <section>
      <h3>官方与媒体</h3>
      <p className="ask-report-coverage"><span>官方来源 {report.coverage.official}</span><span>媒体报道 {report.coverage.media}</span><span>未区分 {report.coverage.unknown}</span><span>结论引用 {cited}</span></p>
      <p>这些数字是这次检索到的资料，不是已核实的新闻条数。来源类型只说明材料出处，不等于事实已经核实。</p>
    </section>}
    {reported.length > 0 && <details className="ask-report-retrieved">
      <summary>查看检索到的报道（{reported.length}）</summary>
      <ol className="ask-report-citations">{reported.slice(0, 8).map((item) => <li key={item.id}>
        <details>
          <summary>[{item.id}] {item.title}</summary>
          <p>{item.sourceName ? `${item.sourceName} · ` : ""}{item.sourceType} · 检索结果，未用于上方结论{item.publishedAt ? ` · 报道发布 ${clockLabel(item.publishedAt)}` : ""}{item.timelineAt ? ` · 站内时间 ${clockLabel(item.timelineAt)}` : ""}{item.mentioned ? ` · 报道中写到 ${item.mentioned}` : ""}</p>
          {item.excerpt && <p>{item.excerpt}</p>}
          {item.siteUrl?.startsWith("/") && <Link to={item.siteUrl}>查看来源</Link>}
        </details>
      </li>)}</ol>
      <p>这些报道没有被用于支持上面的结论。</p>
    </details>}
    {report.heat.length > 0 && <section>
      <h3>热度观察</h3>
      <dl className="ask-report-heat">{report.heat.map((item) => <div key={`${item.evidenceId}-${item.label}`}><dt>{item.label}</dt><dd>{item.value} <small>[{item.evidenceId}]</small></dd></div>)}</dl>
      {report.chart && <div className="ask-report-chart" role="img" aria-label="同一指标的多次统计">{report.chart.map((point) => <div key={`${point.evidenceId}-${point.label}`}>
        <span>{point.label}</span><span className="ask-report-bar"><i style={{ width: `${Math.max(4, Math.round(point.value / max * 100))}%` }}/></span><strong>{point.value}</strong>
      </div>)}</div>}
      <p>这些数字只来自对应证据，不能据此断言热度变化的原因。</p>
    </section>}
    <section>
      <h3>引用</h3>
      {report.citations.length ? <ol className="ask-report-citations">{report.citations.map((item) => <li key={item.id}>
        <details>
          <summary>[{item.id}] {item.title}</summary>
          <p>{item.sourceName ? `${item.sourceName} · ` : ""}{item.sourceType}{item.publishedAt ? ` · 报道发布 ${clockLabel(item.publishedAt)}` : ""}</p>
          {item.siteUrl?.startsWith("/") && <Link to={item.siteUrl}>查看来源</Link>}
        </details>
      </li>)}</ol> : <p>{reported.length ? "目前没有足够证据形成结论；可展开查看检索结果。" : "没有检索到可用于回答的证据。"}</p>}
    </section>
  </div>;
}
function AssistantMessage({ message, busy, onPick }: { message: Message; busy: boolean; onPick: (text: string) => void }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const steps = message.steps ?? [];
  const streaming = !!message.status && !TERMINAL.has(message.status) && message.status !== "send_failed";
  const active = steps.filter((s) => s.status === "running");
  const current = message.plan?.steps.find((step) => step.status === "running");
  const planSettled = !!message.plan && message.plan.steps.every((step) => step.status === "done" || step.status === "skipped" || step.status === "failed");
  const label = current?.goal
    ?? (message.status === "queued" ? "正在排队"
      : message.mode === "deep" && message.status === "running" && !message.plan ? "正在理解问题"
      : message.mode === "deep" && planSettled && !message.report ? "正在整理与核对回答"
      : active.length ? active.map((s) => s.labelZh).join("、")
      : steps.length || message.plan ? "正在整理回答"
      : "正在理解问题");
  return <article className="ask-response" aria-label="助手回答">
    <div className="ask-response-heading"><span className="ask-avatar" aria-hidden="true"><Glyph name="brief" size={17}/></span><span>{message.mode === "deep" ? "深度研究" : "GAMEHOT"}</span>{streaming && <span className="ask-progress" role="status"><span className="ask-progress-label">{label}</span><span className="ask-wait-dots" aria-hidden="true"><i/><i/><i/></span></span>}</div>
    {message.plan && <ResearchProcess plan={message.plan} streaming={streaming}/>}
    {steps.length > 0 && <ProgressSteps steps={steps} streaming={streaming}/>}
    {message.contentInvalidated ? <p className="ask-turn-note">相关来源已不可用，原回答不再展示。</p>
      : message.report ? <ReportView report={message.report}/>
      : message.text ? <Answer text={message.text} evidence={message.evidence ?? []} streaming={streaming} showRetrievedSources={message.status === "completed_degraded"}/>
      : <p className="ask-turn-note" role="status">{streaming ? "正在处理你的问题，请稍候。" : message.status === "send_failed" ? "消息未确认送达，可重试发送。" : message.status === "failed" ? "这次未能生成回答，请稍后再试。" : message.status === "cancelled" ? "已停止生成。" : "本次没有生成回答。"}</p>}
    {message.status === "completed_degraded" && <p className="ask-turn-note">本次结果不完整，请结合来源和限制阅读，或补充问题范围。</p>}
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
  const [input, setInput] = useState(""); const [mode, setMode] = useState<AskMode>("normal"); const [showLatest, setShowLatest] = useState(false);
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
  const switchMode = (next: AskMode) => { setMode(next); };
  const onModeKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? "deep" : "normal";
    switchMode(next);
    document.getElementById(next === "deep" ? "ask-mode-deep" : "ask-mode-normal")?.focus();
  };
  const clearContext = () => { const next = new URLSearchParams(params); next.delete("article"); setParams(next, { replace: true }); };
  const tooLong = [...(input.trim() + (context ? `\n\n关于这篇站内资讯：/items/${context.id}` : ""))].length > 2000;
  const canSend = chat.available === true && !chat.busy && !chat.restoring && !contextLoading && !contextError && !!input.trim() && !tooLong;
  const submit = async (event?: FormEvent) => {
    event?.preventDefault(); if (!canSend) return;
    const text = input.trim() + (context ? `\n\n关于这篇站内资讯：/items/${context.id}` : ""); setInput(""); follow.current = true; await chat.send(text, undefined, mode);
  };
  const starters = mode === "deep" ? DEEP_STARTERS : STARTERS;
  return <div className={`ask-page${empty ? " is-empty" : ""}`} data-pull-refresh="disabled" data-research-mode={mode}>
    <header className="ask-page-header"><Link to="/ask" className="ask-page-name">AI 问答</Link><button type="button" className="ask-new-chat" disabled={chat.busy || chat.restoring} onClick={() => { chat.reset(); setInput(""); follow.current = false; }}><Glyph name="plus" size={16}/>新对话</button></header>
    <div className="ask-scroll-frame">
    <div ref={scroll} className="ask-scroll" role="region" aria-label="问答内容" tabIndex={0} onPointerDown={() => { follow.current = false; }}>
    {empty && !chat.restoring && <section className="ask-intro" aria-labelledby="ask-heading"><div className="ask-intro-mark" aria-hidden="true"><span/><span/><span/></div>
      <h1 id="ask-heading"><span className="ask-title-line">游戏圈的消息，</span><span className="ask-title-line">帮你理清楚。</span></h1><p key={mode}>{mode === "deep" ? <>复杂问题会先拆成步骤，<br className="ask-phone-break"/>再按步骤核对站内报道和热点。</> : <>从一篇报道到一场热议，<br className="ask-phone-break"/>把重点、进展和出处放在一起。</>}</p></section>}
    {chat.restoring && <p className="ask-restore" role="status">正在恢复对话…</p>}
    {!empty && <div className="ask-conversation" aria-label="问答记录"><h1 className="sr-only">AI 问答记录</h1>{chat.messages.map((m, i) => m.role === "user"
      ? <div className="ask-user" key={m.key}><span className="ask-user-label">你</span><p>{m.text.replace(contextSuffix, "")}{m.text.match(contextSuffix)?.[1] && <Link className="ask-user-context" to={m.text.match(contextSuffix)![1]!}>附带资讯</Link>}</p></div>
      : <div key={m.key}><AssistantMessage message={m} busy={chat.busy} onPick={pick}/>{m.status === "send_failed" && <button className="ask-retry" type="button" disabled={chat.busy} onClick={() => { const user = chat.messages[i - 1]; if (user?.requestId) { follow.current = true; void chat.send(user.text, user); } }}>重试发送</button>}</div>)}</div>}
    {empty && !chat.restoring && <section key={mode} className={`ask-starters is-swap${mode === "deep" ? " is-deep" : ""}`} aria-label={mode === "deep" ? "深度研究示例" : "试试这样问"}>{starters.map((s) => <button type="button" key={s.name} onFocus={(event) => finishEntrance(event.currentTarget)} onClick={() => pick(s.question)}><span className="ask-starter-icon"><Glyph name={s.icon}/></span><span><strong>{s.name}</strong><small>{s.description}</small></span></button>)}</section>}
    </div>
    <span className={`ask-scroll-fade is-top${scrollFades.top ? " is-visible" : ""}`} aria-hidden="true"/>
    <span className={`ask-scroll-fade is-bottom${scrollFades.bottom ? " is-visible" : ""}`} aria-hidden="true"/>
    </div>
    {!chat.restoring && <div className="ask-composer-area" onFocusCapture={(event) => finishEntrance(event.currentTarget)}>
      {showLatest && <button type="button" className="ask-latest" onClick={() => { follow.current = true; latest(); }}>回到最新回答 ↓</button>}
      {chat.disconnected && <p className="ask-notice" role="status">连接中断，正在恢复。已提交的任务仍会继续，请勿重复发送。</p>}
      {chat.error && <p className="ask-error" role="alert">{chat.error}</p>}
      {chat.available === false && <p className="ask-notice" role="status">问答暂未开放。你仍可<Link to="/">浏览精选</Link>或阅读已有对话。</p>}
      <form className={`ask-composer${mode === "deep" ? " is-deep" : ""}`} onSubmit={(event) => void submit(event)}>
        <div className={`ask-mode-switch${mode === "deep" ? " is-deep" : ""}`} role="radiogroup" aria-label="研究模式" onKeyDown={onModeKey}>
          <span className="ask-mode-thumb" aria-hidden="true"/>
          <button id="ask-mode-normal" type="button" role="radio" aria-checked={mode === "normal"} tabIndex={mode === "normal" ? 0 : -1} onClick={() => switchMode("normal")}>普通研究</button>
          <button id="ask-mode-deep" type="button" role="radio" aria-checked={mode === "deep"} tabIndex={mode === "deep" ? 0 : -1} onClick={() => switchMode("deep")}>深度研究</button>
        </div>
        <p className="ask-mode-note" id="ask-mode-note" key={mode}>{mode === "deep" ? "简单问题直接回答，复杂问题按需规划、检索与核对。切换只影响下一次发送。" : "按需检索，快速回答。切换模式只改变下一次发送。"}</p>
        {(context || contextLoading || contextError) && <div className="ask-context"><div><span>正在围绕这篇资讯提问</span><p>{contextLoading ? "正在读取资讯…" : contextError ?? context?.title}</p></div><button type="button" aria-label="移除资讯上下文" onClick={clearContext}>×</button></div>}
        <label htmlFor="ask-input" className="sr-only">你的游戏资讯问题</label>
        <textarea id="ask-input" ref={textarea} value={input} maxLength={2000} rows={2} placeholder={context ? "继续问这篇资讯…" : mode === "deep" ? "想比较两款游戏、梳理时间线，或对照官方和媒体？" : "想了解哪款游戏，或最近发生了什么？"} aria-describedby="ask-mode-note ask-input-note" onChange={(e) => setInput(e.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !composing.current && e.keyCode !== 229) { e.preventDefault(); if (canSend) void submit(); }
        }}/>
        <div className="ask-composer-toolbar"><span id="ask-input-note">{tooLong ? "问题与附带资讯合计不能超过2000字" : chat.busy ? "可以先写下一个问题" : "Enter 发送，Shift + Enter 换行"}</span>{chat.busy ? <button type="button" className="ask-send is-stop" onClick={() => void chat.stop()} aria-label="停止生成"><span/>停止</button> : <button type="submit" className="ask-send" disabled={!canSend} aria-label="发送问题"><Glyph name="send" size={20}/></button>}</div>
      </form>
      <p className="ask-footnote">{mode === "deep" ? "深度研究只引用本次检索到的站内资料。" : "依据站内公开报道回答，附来源供核对。"}<span>{mode === "deep" ? "不搜全网，不编造来源。" : "不搜全网，不提供游戏攻略。"}</span></p>
    </div>}
  </div>;
}
