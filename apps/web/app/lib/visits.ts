import { useEffect, useRef } from "react";

/** Report committed page navigation, never prefetches or query-only input changes. No visitor cookie. */
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
      body: JSON.stringify({ path: pathname, referrer }),
      keepalive: true,
    }).catch(() => {});
  }, [pathname]);
}
