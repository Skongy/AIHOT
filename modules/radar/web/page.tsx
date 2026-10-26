import { useState } from "react";
import { useLoaderData } from "react-router";
import { cachedPage, loadOr404 } from "../../../apps/web/app/lib/api.server";
import { pageMeta } from "../../../apps/web/app/lib/seo";
import type { Screen } from "../../../apps/web/app/components/shell/screens";
import type { RadarEvent, RadarMonth } from "../types";
import { Monthly } from "./Monthly";
import { Chart } from "./Chart";
import "./radar.css";
export const handle: Screen = { tab: "me", name: "游戏异动" };
export { pageHeaders as headers } from "../../../apps/web/app/lib/api.server";
export async function loader({ request }: { request: Request }) {
  const query = new URL(request.url).searchParams;
  const month = query.get("month") ?? query.get("event")?.slice(-10, -3) ?? new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Response("Invalid month", { status: 400 });
  return cachedPage(60, await loadOr404<RadarMonth>(`/api/radar/month?month=${month}`, { signal: request.signal }));
}
export function meta() { return pageMeta({ title: "游戏异动", path: "/radar", description: "发现Steam游戏的异常增长，按月份回顾有记录、有依据的走红事件。" }); }
function Cover({ event }: { event: RadarEvent }) {
  const [failed, setFailed] = useState<string | null>(null);
  return !event.coverUrl || failed === event.coverUrl ? <div className="cover-fallback">{event.name}<small>封面暂不可用</small></div> : <img src={event.coverUrl} alt={event.name} loading="lazy" onError={() => setFailed(event.coverUrl)} ref={node => { if (node?.complete && node.naturalWidth === 0) setFailed(event.coverUrl); }}/>;
}
export default function RadarPage() {
  const data = useLoaderData<typeof loader>();
  return <div className="radar-app news-workspace"><Monthly data={data} renderImage={event => <Cover key={event.coverUrl ?? event.id} event={event}/>} renderChart={(event, large) => <Chart key={`${event.id}-${large}`} event={event} large={large}/>}/></div>;
}
