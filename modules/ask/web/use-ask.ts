import { useCallback, useEffect, useRef, useState } from "react";
import { applyAskEvent, snapshotReport, snapshotResearch, snapshotSteps, TERMINAL, type AskMode, type Message } from "./types";

const SESSION_KEY = "gamehot:ask:sessionId";
const savedSession = () => { try { return localStorage.getItem(SESSION_KEY); } catch { return null; } };
function saveSession(id: string | null) { try { if (id) localStorage.setItem(SESSION_KEY, id); else localStorage.removeItem(SESSION_KEY); } catch { /* Chat still works for this visit. */ } }
function newId() {
  const crypto = globalThis.crypto as Crypto | undefined;
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  if (!crypto?.getRandomValues) return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => { const n = Math.random() * 16 | 0; return (ch === "x" ? n : (n & 3) | 8).toString(16); });
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.detail ?? `请求失败（${res.status}），请稍后重试。`), { status: res.status });
  return data;
}
function fromSnapshot(snap: any, key: string): Message {
  return { key, role: "assistant", taskId: snap.taskId, status: snap.status, mode: snap.mode === "deep" ? "deep" : "normal", steps: snapshotSteps(snap.steps), plan: snapshotResearch(snap.research), evidence: snap.evidence ?? [],
    text: snap.contentInvalidated ? "相关来源已不可用，原回答不再展示" : snap.finalAnswer ?? snap.draftAnswer ?? "", contentInvalidated: snap.contentInvalidated, report: snapshotReport(snap.research) };
}

export function useAsk() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const session = useRef<string | null>(null);
  const stream = useRef<EventSource | null>(null);
  const task = useRef<string | null>(null);
  const lock = useRef(false);
  const generation = useRef(0);
  const close = useCallback(() => { stream.current?.close(); stream.current = null; }, []);
  const subscribe = useCallback((id: string, after: number, key: string) => {
    close(); task.current = id;
    const es = new EventSource(`/api/ask/tasks/${id}/events?after=${after}`);
    stream.current = es;
    let cursor = after;
    es.onopen = () => setDisconnected(false);
    es.onerror = () => { if (stream.current === es) setDisconnected(true); };
    for (const type of ["answer_delta", "answer_done", "step_start", "step_end", "evidence", "task_status", "error", "limit", "citation_check", "research_plan", "research_step", "research_claims", "research_report"]) {
      es.addEventListener(type, (event) => {
        if (stream.current !== es) return;
        const ev = event as MessageEvent;
        const seq = Number(ev.lastEventId);
        if (seq && seq <= cursor) return;
        let p: Record<string, any>;
        try { p = JSON.parse(ev.data).payload ?? {}; } catch { return; }
        if (seq) cursor = seq;
        if (type === "error") setError(String(p.message ?? "生成失败，请稍后重试。"));
        setMessages((prev) => prev.map((m) => m.key === key ? applyAskEvent(m, type, p) : m));
        if (type === "task_status" && TERMINAL.has(String(p.status))) {
          close(); lock.current = false; setBusy(false); setDisconnected(false);
        }
      });
    }
  }, [close]);

  useEffect(() => {
    const epoch = ++generation.current;
    let cancelled = false;
    session.current = savedSession();
    void json("/api/ask/capabilities").then((data) => { if (!cancelled) setAvailable(data.available); }).catch(() => { if (!cancelled) setError("暂时无法连接问答服务，请刷新后重试。"); });
    void (async () => {
      try {
        if (!session.current) return;
        const data = await json(`/api/ask/sessions/${session.current}`);
        const restored = await Promise.all((data.messages ?? []).map(async (m: any): Promise<Message> => {
          if (m.role !== "assistant" || !m.taskId) return { key: m.id, role: m.role, text: m.content };
          const snap = await json(`/api/ask/tasks/${m.taskId}`);
          return fromSnapshot(snap, m.id);
        }));
        if (cancelled || generation.current !== epoch) return;
        const running = (data.recentTasks ?? []).find((t: any) => t.status === "queued" || t.status === "running");
        if (running) {
          const snap = await json(`/api/ask/tasks/${running.id}`);
          if (cancelled || generation.current !== epoch) return;
          const index = restored.findIndex((m) => m.role === "assistant" && m.taskId === running.id);
          const message = fromSnapshot(snap, index < 0 ? running.id : restored[index]!.key);
          if (index < 0) restored.push(message); else restored[index] = message;
          if (!TERMINAL.has(snap.status)) { lock.current = true; setBusy(true); subscribe(running.id, snap.snapshotSeq ?? 0, message.key); }
        }
        setMessages(restored);
      } catch (e) {
        if (cancelled) return;
        if ((e as { status?: number }).status === 404) { session.current = null; saveSession(null); }
        else setError("历史对话暂时无法加载，请刷新重试。为避免重复生成，请先确认原任务状态。");
      } finally { if (!cancelled) setRestoring(false); }
    })();
    return () => { cancelled = true; close(); };
  }, [close, subscribe]);

  const send = async (text: string, retry?: Message, mode: AskMode = retry?.mode ?? "normal") => {
    if (!text.trim() || lock.current || restoring || available !== true) return false;
    lock.current = true; setBusy(true); setError(null); setDisconnected(false);
    const requestId = retry?.requestId ?? newId();
    const user: Message = retry ?? { key: requestId, role: "user", text: text.trim(), requestId, mode };
    const key = `${requestId}:answer`;
    setMessages((prev) => retry ? prev.map((m) => m.key === key ? { key, role: "assistant", text: "", status: "queued", mode: user.mode } : m)
      : [...prev, user, { key, role: "assistant", text: "", status: "queued", mode: user.mode }]);
    try {
      if (!session.current) {
        const data = await json("/api/ask/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        session.current = data.sessionId; saveSession(data.sessionId);
      }
      const post = () => json(`/api/ask/sessions/${session.current}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: user.text, clientRequestId: requestId, mode: user.mode ?? "normal" }) });
      let data;
      try { data = await post(); }
      catch (e) {
        if ((e as { status?: number }).status !== 404) throw e;
        const fresh = await json("/api/ask/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        session.current = fresh.sessionId; saveSession(fresh.sessionId); data = await post();
      }
      // Always resume through a snapshot: retrying an accepted request must not duplicate its answer.
      const snap = await json(`/api/ask/tasks/${data.taskId}`);
      setMessages((prev) => prev.map((m) => m.key === key ? { ...fromSnapshot(snap, key), requestId } : m));
      if (TERMINAL.has(snap.status)) { lock.current = false; setBusy(false); }
      else subscribe(data.taskId, snap.snapshotSeq ?? 0, key);
      return true;
    } catch (e) {
      setError((e as Error).message || "网络连接失败，请重试。");
      setMessages((prev) => prev.map((m) => m.key === key ? { ...m, status: "send_failed" } : m));
      lock.current = false; setBusy(false); return false;
    }
  };
  const stop = async () => {
    if (!task.current) return;
    try { await json(`/api/ask/tasks/${task.current}/cancel`, { method: "POST" }); }
    catch { setError("停止请求未送达，请重试。关闭页面不会停止生成。"); }
  };
  const reset = () => {
    if (lock.current) return;
    generation.current++; close(); session.current = null; saveSession(null); task.current = null; setMessages([]); setError(null); setDisconnected(false);
  };
  return { messages, busy, restoring, available, error, disconnected, send, stop, reset };
}
