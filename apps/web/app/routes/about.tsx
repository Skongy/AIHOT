import { useState } from "react";
import { IntentLink } from "../components/ui/IntentLink";
import { Link, useLoaderData } from "react-router";
import type { SiteContact, SiteStats } from "@aihot/contracts/site";
import { ABOUT, POLICY, SITE } from "@aihot/site";
import { apiGet, cachedPage } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { organizationLd, pageMeta } from "../lib/seo";
import { Kicker } from "../components/ui/Kicker";
import { buttonClass } from "../components/ui/Controls";
import { IconArrowRight } from "../components/icons";
import { HeatField } from "../features/about/HeatField";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "me", name: "关于" };
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: { request: Request }) {
  const [contact, stats] = await Promise.all([
    apiGet<SiteContact>("/api/site/contact", { signal: request.signal }).catch(() => null),
    apiGet<SiteStats>("/api/site/stats", { signal: request.signal }).catch(() => null),
  ]);
  const today = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" }).format(new Date()).replace("/", ".");
  return cachedPage(300, { contact, stats, today });
}

export function meta() {
  return pageMeta({ title: "关于", description: ABOUT.description, path: "/about", image: "/og/pages/about.png", jsonLd: organizationLd() });
}

/** 3.6 万 from ten thousand up, digits with separators below. */
function figure(n: number): { value: string; unit: string } {
  return n >= 10_000 ? { value: (n / 10_000).toFixed(1).replace(/\.0$/, ""), unit: "万" } : { value: n.toLocaleString("en-US"), unit: "" };
}

function HeroFigure({ n, label }: { n: number; label: string }) {
  const f = figure(n);
  return (
    <div>
      <div className="flex items-baseline gap-1">
        <span className="num text-[20px] font-black leading-none tracking-[-0.03em] text-ink">{f.value}</span>
        {f.unit && <span className="text-[11px] font-semibold text-ink-3">{f.unit}</span>}
      </div>
      <span className="mt-1 block text-[10px] text-ink-4">{label}</span>
    </div>
  );
}

/** The maker's round avatar before the greeting; it steps aside if the image fails. */
function MakerFace({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img src={src} alt={`${ABOUT.maker?.name ?? ""}的头像`} width={48} height={48} onError={() => setFailed(true)} className="size-11 shrink-0 rounded-full bg-bg-sunk object-cover ring-1 ring-line xl:size-12" />;
}

function QrCard({ src, kind, title, note }: { src: string; kind: string; title: string; note: string }) {
  return (
    <figure className="card flex items-center gap-5 p-5">
      <img src={src} alt={`${kind}二维码`} width={112} height={112} loading="lazy" className="size-[104px] shrink-0 rounded-tile border border-line bg-white object-contain p-1.5 sm:size-[112px]" />
      <figcaption className="min-w-0">
        <div className="text-[12px] text-ink-4">{kind}</div>
        <div className="mt-1 text-[16px] font-semibold leading-snug text-ink">{title}</div>
        <p className="mt-2 text-[13px] leading-[1.7] text-ink-3">{note}</p>
      </figcaption>
    </figure>
  );
}

/**
 * The optional maker block (ABOUT.maker): a greeting on the left, the contact codes that are set on the
 * right. Without the contact settings (the api did not answer) the codes stay out, as the figures do.
 */
function Maker({ maker, contact }: { maker: NonNullable<typeof ABOUT.maker>; contact: SiteContact | null }) {
  const codes = [
    contact?.wechatQr && maker.wechat ? <QrCard key="wechat" src={contact.wechatQr} kind={maker.wechat.kind} title={maker.wechat.title} note={maker.wechat.note} /> : null,
    contact?.feishuQr && maker.feishu ? <QrCard key="feishu" src={contact.feishuQr} kind={maker.feishu.kind} title={maker.feishu.title} note={maker.feishu.note} /> : null,
  ].filter(Boolean);
  return (
    <section aria-labelledby="maker" className="mt-20 grid gap-10 xl:mt-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
      <div>
        <Kicker>做这个站的人</Kicker>
        <h2 id="maker" className="mt-4 flex items-center gap-3.5 text-[26px] font-black leading-[1.3] tracking-[-0.02em] text-ink xl:gap-4 xl:text-[34px]">
          {contact?.makerAvatar && <MakerFace src={contact.makerAvatar} />}
          <span>
            嗨，我是 <span className="whitespace-nowrap text-accent">{maker.name}</span>
          </span>
        </h2>
        <div className="mt-5 space-y-4 text-[15.5px] leading-[1.9] text-ink-2 xl:text-[16.5px]">
          {maker.greeting.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p className="text-ink-3">
            它一直在改，改了什么都写在
            <Link viewTransition to="/changelog" className="text-accent hover:underline">
              更新日志
            </Link>
            里。
          </p>
        </div>
      </div>
      {codes.length > 0 && (
        <div className="grid content-start gap-3">
          <h3 className="text-[15px] font-semibold text-ink">如果觉得有点用，欢迎加入</h3>
          {codes}
        </div>
      )}
    </section>
  );
}

export default function AboutPage() {
  const { contact, stats, today } = useLoaderData<typeof loader>();

  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-14 lg:pt-3">
      <PhoneBar back={{ to: "/more", label: "我的" }} title={`关于 ${SITE.name}`} />
      <header className="grid items-end gap-8 pt-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,.7fr)] lg:gap-12 lg:pt-0">
        <div>
          <Kicker>{ABOUT.kicker}</Kicker>
          <h1 data-page-title="" className="mt-4 text-[34px] font-black leading-[1.16] tracking-[-0.03em] text-ink [text-wrap:balance] sm:text-[46px] xl:text-[50px] 2xl:text-[56px]">
            {ABOUT.headline[0]}
            <br />
            <span className="text-accent">{ABOUT.headline[1]}</span>
          </h1>
        </div>
        <div className="lg:pb-1">
          <p className="max-w-[38em] text-[15px] leading-[1.75] text-ink-3 xl:text-[15px]">{ABOUT.lead}</p>
          <div className="mt-4 flex gap-7 border-t border-line pt-3.5">
            {stats && <HeroFigure n={stats.items} label="条动态已整理" />}
            <div>
              <div className="num text-[20px] font-black leading-none tracking-[-0.03em] text-ink">08:00</div>
              <span className="mt-1 block text-[10px] text-ink-4">每天准时成刊</span>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <IntentLink to="/" className={buttonClass("primary", "lg")}>
              看今天的精选 <IconArrowRight size={15} />
            </IntentLink>
            <IntentLink to="/daily" className={buttonClass("secondary", "lg")}>
              读最新日报
            </IntentLink>
          </div>
        </div>
      </header>

      <HeatField stats={stats} date={today} />

      {ABOUT.maker && <Maker maker={ABOUT.maker} contact={contact} />}

      <p className="mt-16 well rounded-card px-5 py-4 text-[13px] leading-[1.85] text-ink-3">
        {ABOUT.copyright}
      </p>

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-[12.5px] text-ink-4">
        <span>{SITE.footerNote}</span>
        <nav className="flex gap-5" aria-label="规则与隐私">
          <Link
            viewTransition
            id={ABOUT.termsAnchor ?? undefined}
            to="/terms"
            className="transition-colors hover:text-accent"
          >
            {POLICY.terms.name}
          </Link>
          <Link viewTransition to="/privacy" className="transition-colors hover:text-accent">
            隐私说明
          </Link>
        </nav>
      </footer>
    </div>
  );
}
