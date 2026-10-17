// 站点的字标和圆环标记：页面用 Wordmark 画站名（size 是高度，单位像素），RingMark 是小标记，转起来就是加载动画。
import { SITE } from "../site.ts";

export function Wordmark({ size = 24, className = "", title = SITE.name }: { size?: number; className?: string; title?: string }) {
  const height = Math.round(size * (size < 20 ? 0.82 : 1));
  const width = Math.round(height * (1024 / 156));
  return (
    <span
      className={`inline-flex shrink-0 items-center ${className}`}
      style={{ width, height }}
      aria-label={title}
      role="img"
    >
      <img
        src="/wordmark.png?v=gamehot-art-1"
        width={1024}
        height={156}
        alt=""
        aria-hidden="true"
        className="h-full w-full object-contain dark:hidden"
      />
      <img
        src="/wordmark-dark.png?v=gamehot-art-1"
        width={1024}
        height={156}
        alt=""
        aria-hidden="true"
        className="hidden h-full w-full object-contain dark:block"
      />
    </span>
  );
}

/** A ring with a dot; spinning, it is the loader. */
export function RingMark({ className = "", spinning = false }: { className?: string; spinning?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <g style={spinning ? { transformOrigin: "12px 12px", animation: "spin-slow 1.1s linear infinite" } : undefined}>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="42 15" />
      </g>
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
    </svg>
  );
}
