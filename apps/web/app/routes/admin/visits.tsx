import { Form, useSearchParams, useRevalidator } from "react-router";
import { SITE } from "@aihot/site";
import type { AdminVisits } from "@aihot/contracts/admin";
import type { Route } from "./+types/visits";
import { adminGet } from "../../lib/admin.server";
import { bj } from "../../features/admin/format";
import { AdminPage, Button, Card, DataTable, Input, Pager } from "../../features/admin/ui";

export async function loader({ request }: Route.LoaderArgs) {
  return adminGet<AdminVisits>(request, `/api/admin/visits${new URL(request.url).search}`);
}

export const meta: Route.MetaFunction = () => [{ title: `访问记录 · ${SITE.name} 后台` }];

export default function Visits({ loaderData: data }: Route.ComponentProps) {
  const [sp] = useSearchParams();
  const revalidator = useRevalidator();
  return (
    <AdminPage title="访问记录" subtitle="页面浏览记录，保留 30 天。时间为北京时间；不同 IP 数不等于独立访客人数。"
      actions={<Button onClick={() => revalidator.revalidate()} busy={revalidator.state === "loading"}>刷新记录</Button>}>
      <Form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-[12.5px] text-ink-3">访问日期（北京时间）<Input type="date" name="date" key={data.date} defaultValue={data.date} required /></label>
        <label className="grid min-w-0 gap-1 text-[12.5px] text-ink-3">IP 地址<Input name="ip" key={sp.get("ip")} defaultValue={sp.get("ip") ?? ""} placeholder="IPv4 或 IPv6，精确匹配" /></label>
        <Button type="submit">筛选</Button>
      </Form>
      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink-3" aria-live="polite">
        <span>所选范围浏览量 <strong className="num font-semibold text-ink">{data.summary.views.toLocaleString("zh-CN")}</strong></span>
        <span>不同 IP <strong className="num font-semibold text-ink">{data.summary.ips.toLocaleString("zh-CN")}</strong></span>
      </div>
      <p className="mb-2 text-[12px] text-ink-4 sm:hidden">表格可左右滑动查看完整记录</p>
      <Card pad={false}>
        <DataTable rows={data.rows} rowKey={(r) => r.id} empty="所选日期暂无访问记录" columns={[
          { key: "time", label: "访问时间", render: (r) => <span className="num whitespace-nowrap">{bj(r.visited_at, true)}</span> },
          { key: "ip", label: "IP 地址", render: (r) => <span className="break-all font-mono text-[12px]">{r.ip}</span> },
          { key: "path", label: "页面", render: (r) => <span className="block max-w-[260px] break-all">{r.path}</span> },
          { key: "referrer", label: "来源站点", render: (r) => <span className="block max-w-[220px] break-all">{r.referrer_origin ?? "直接访问 / 未提供"}</span> },
          { key: "browser", label: "浏览器信息", render: (r) => r.user_agent ? <details className="max-w-[280px]"><summary className="cursor-pointer text-ink-3">查看 User-Agent</summary><p className="mt-1 break-all text-[12px]">{r.user_agent}</p></details> : "未提供" },
        ]} />
      </Card>
      <Pager page={data.page} hasMore={data.hasMore} />
      <p className="mt-4 text-[12px] leading-relaxed text-ink-4">仅统计启用 JavaScript 的页面浏览，不含静态资源、API 请求和后台访问。广告拦截、网络中断或限流可能导致漏记；浏览器信息由客户端提供，不能用来确认身份。</p>
    </AdminPage>
  );
}
