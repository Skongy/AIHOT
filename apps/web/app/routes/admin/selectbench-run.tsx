import { SITE } from "@aihot/site";
import { Fragment, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { CATEGORY_LABELS } from "@aihot/contracts/taxonomy";
import type { Route } from "./+types/selectbench-run";
import type { AdminSelectBenchCases, AdminSelectBenchDecision, AdminSelectBenchModelSummary } from "@aihot/contracts/admin";
import { adminGet } from "../../lib/admin.server";
import { bj, num, pct } from "../../features/admin/format";
import { AdminPage, Badge, Card, Empty, FilterChips, Select } from "../../features/admin/ui";


export async function loader({ request, params }: Route.LoaderArgs) {
  return adminGet<AdminSelectBenchCases>(request, `/api/admin/selectbench/${encodeURIComponent(params.runId)}${new URL(request.url).search}`);
}

export const meta: Route.MetaFunction = ({ loaderData }) => [{ title: `${loaderData?.run.label ?? "SelectBench"} · ${SITE.name} 后台` }];

const GOLD: Record<string, [string, "accent" | "muted" | "info"]> = { select: ["应入选", "accent"], reject: ["不选", "muted"], either: ["两可", "info"] };

function asSummary(raw: AdminSelectBenchModelSummary | undefined): AdminSelectBenchModelSummary {
  return raw ?? {};
}

function verdict(d: AdminSelectBenchDecision | undefined, gold: string) {
  if (!d) return <span className="text-ink-4">—</span>;
  if (d.decision === null) return <Badge tone="bad" title={d.error ?? undefined}>失败</Badge>;
  const right = gold === "either" || d.decision === gold;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={right ? (d.decision === "select" ? "ok" : "muted") : "bad"}>{d.decision === "select" ? "入选" : "不选"}</Badge>
      <span className="num text-[12px] text-ink-3">{d.score ?? "—"}</span>
    </span>
  );
}

export default function SelectBenchRun({ loaderData: d }: Route.ComponentProps) {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const model = sp.get("model") ?? d.run.models[0]!;
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    navigate(`?${next}`, { preventScrollReset: true });
  };
  const summary = asSummary(d.run.summary[model]);
  const byTier = summary.byTier ?? {};
  const tierKeys = Object.keys(byTier).sort();
  const sweep = Array.isArray(summary.sweep) ? summary.sweep : [];
  const suggested = summary.suggested && typeof summary.suggested === "object" ? summary.suggested as Record<string, unknown> : null;

  return (
    <AdminPage
      title={d.run.label}
      subtitle={<>{bj(d.run.created_at, true)} · {d.run.split ?? "—"} · {num(d.run.sample_size)} 条 · 提示 {d.run.prompt_version ?? "未记录"} · <Link className="text-accent" to="/admin/selectbench">全部运行</Link></>}
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {d.run.models.map((m) => {
          const s = asSummary(d.run.summary[m]);
          return (
            <button key={m} onClick={() => set("model", m)} className={`rounded-panel p-4 text-left ring-1 transition-colors ${m === model ? "bg-accent-softer ring-accent/40" : "bg-surface ring-line hover:bg-bg-sunk/60"}`}>
              <div className="text-[13.5px] font-semibold text-ink">{m}</div>
              <div className="num mt-1.5 text-[22px] font-semibold tracking-tight text-ink">F1 {pct(s.f1)}</div>
              <div className="num mt-0.5 text-[12px] text-ink-3">准确 {pct(s.accuracy)} · 精确 {pct(s.precision)} · 召回 {pct(s.recall)}</div>
              <div className="num mt-0.5 text-[12px] text-ink-4">误选 {s.fp ?? "—"} · 漏选 {s.fn ?? "—"} · 失败 {s.errors ?? 0}</div>
            </button>
          );
        })}
      </div>

      {tierKeys.length > 0 && (
        <Card title={`按信源分级（${model}）`} className="mb-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {tierKeys.map((tier) => {
              const t = byTier[tier] ?? {};
              return (
                <div key={tier} className="rounded-control bg-bg-sunk/40 p-3 ring-1 ring-line">
                  <div className="text-[13px] font-semibold text-ink">{tier}</div>
                  <div className="num mt-1 text-[18px] font-semibold text-ink">F1 {pct(t.f1)}</div>
                  <div className="num mt-0.5 text-[12px] text-ink-3">精确 {pct(t.precision)} · 召回 {pct(t.recall)} · 准确 {pct(t.accuracy)}</div>
                  <div className="num mt-0.5 text-[12px] text-ink-4">decisive {t.decisive ?? "—"} · 入选率 {pct(t.selectedRate)}</div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {sweep.length > 0 && (
        <Card
          title={`门槛扫描（统一平均分 t，${model}）`}
          right={suggested ? <span className="text-[12px] text-ink-3">建议 t={String(suggested.uniformMean ?? "—")}（只读，不写回 selection.ts）</span> : undefined}
          className="mb-5"
          pad={false}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[12px] text-ink-3">
                  {["t", "准确率", "精确率", "召回率", "F1", "入选比例"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {sweep.map((row) => {
                  const highlight = suggested && row.t === suggested.uniformMean;
                  return (
                    <tr key={String(row.t)} className={`border-b border-line/70 last:border-0 ${highlight ? "bg-accent-softer/60" : ""}`}>
                      <td className="num px-3 py-1.5 font-medium text-ink">{row.t}{highlight ? " · 建议" : ""}</td>
                      <td className="num px-3 py-1.5">{pct(row.acc)}</td>
                      <td className="num px-3 py-1.5">{pct(row.P)}</td>
                      <td className="num px-3 py-1.5">{pct(row.R)}</td>
                      <td className="num px-3 py-1.5 font-semibold text-ink">{pct(row.F1)}</td>
                      <td className="num px-3 py-1.5">{pct(row.sel)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {suggested?.note ? <p className="border-t border-line px-4 py-2 text-[12.5px] text-ink-3">{String(suggested.note)}</p> : null}
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterChips
          param="outcome"
          options={[
            { value: "", label: "全部" },
            { value: "fp", label: "误选" },
            { value: "fn", label: "漏选" },
            { value: "tp", label: "选对" },
            { value: "tn", label: "正确不选" },
            { value: "either", label: "两可" },
            { value: "error", label: "失败" },
          ]}
        />
        <Select className="!w-auto" aria-label="样本分层" value={sp.get("stratum") ?? ""} onChange={(e) => set("stratum", e.target.value || null)}>
          <option value="">全部分层</option>
          {d.strata.map((s) => <option key={s.stratum ?? "none"} value={s.stratum ?? ""}>{s.stratum ?? "未分层"}（{s.n}）</option>)}
        </Select>
        <label className="inline-flex items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={sp.get("disagree") === "1"} onChange={(e) => set("disagree", e.target.checked ? "1" : null)} />
          只看模型之间有分歧的
        </label>
        <span className="text-[12.5px] text-ink-4">{d.rows.length === 400 ? "仅显示前 400 条" : `${d.rows.length} 条`} · 筛选按 {model}</span>
      </div>
      <Card pad={false}>
        {d.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[12px] text-ink-3">
                  <th className="px-3 py-2 font-medium">样本</th>
                  <th className="px-3 py-2 font-medium">金标</th>
                  {d.run.models.map((m) => <th key={m} className="px-3 py-2 font-medium">{m}</th>)}
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <Fragment key={r.case_id}>
                    <tr className="cursor-pointer border-b border-line/70 hover:bg-bg-sunk/50" onClick={() => setOpen(open === r.case_id ? null : r.case_id)}>
                      <td className="max-w-[420px] px-3 py-2.5">
                        <div className="line-clamp-2 text-ink">{r.title}</div>
                        <div className="mt-0.5 text-[11.5px] text-ink-4">{r.stratum ?? "—"} · {r.case_id}</div>
                      </td>
                      <td className="px-3 py-2.5"><Badge tone={GOLD[r.gold]?.[1] ?? "muted"}>{GOLD[r.gold]?.[0] ?? r.gold}</Badge></td>
                      {d.run.models.map((m) => <td key={m} className="px-3 py-2.5">{verdict(r.by_model[m], r.gold)}</td>)}
                    </tr>
                    {open === r.case_id && (
                      <tr className="border-b border-line/70 bg-bg-sunk/40">
                        <td colSpan={2 + d.run.models.length} className="px-3 py-3">
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {d.run.models.map((m) => {
                              const x = r.by_model[m];
                              return (
                                <div key={m} className="rounded-control bg-surface p-3 ring-1 ring-line">
                                  <div className="mb-1 flex items-center justify-between text-[12px] text-ink-3"><span className="font-medium text-ink-2">{m}</span>{x?.category && <span>{CATEGORY_LABELS[x.category as keyof typeof CATEGORY_LABELS] ?? x.category}</span>}</div>
                                  <div className="text-[12.5px] leading-relaxed text-ink-2">{x?.error ?? x?.reason ?? "（没有理由）"}</div>
                                  <div className="mt-1 text-[11.5px] text-ink-4">相关性 {x?.relevance ?? "—"}{x?.receiptId ? ` · 回执 #${x.receiptId}` : ""}</div>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>没有符合条件的样本</Empty>
        )}
      </Card>
    </AdminPage>
  );
}
