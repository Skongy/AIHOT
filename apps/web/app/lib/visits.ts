import { useEffect, useRef } from "react";
import { analyticsModule } from "@aihot/contracts/analytics";

/** Random first-party browser ID; Web Crypto also works on the site's current HTTP origin. */
function anonymousVisitor(): string | null {
  try {
    const saved = localStorage.getItem("gamehot-visitor-v1");
    if (saved && /^[a-f0-9]{32}$/.test(saved)) return saved;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem("gamehot-visitor-v1", id);
    return id;
  } catch { return null; } // Storage disabled: never invent a fresh visitor on every navigation.
}

/** Report committed page navigation, never prefetches or query-only input changes. No cookies sent. */
export function useVisitTracking(pathname: string) {
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (previous.current === pathname) return;
    const referrer = previous.current ? location.origin : (document.referrer ? new URL(document.referrer).origin : "");
    previous.current = pathname;
    if (/^\/admin(?:\/|$)/i.test(pathname)) return;
    void fetch("/api/site/visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ path: pathname, referrer, visitor: analyticsModule(pathname) ? anonymousVisitor() : null }),
      keepalive: true,
    }).catch(() => {});
  }, [pathname]);
}
