import type { MouseEvent as ReactMouseEvent } from "react";

/** Card cursor spotlight: dark throughout the site, light on the desktop news workspace. */
export function onCardSpotlightMove(e: ReactMouseEvent<HTMLElement>) {
  if (typeof window === "undefined") return;
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const el = e.currentTarget;
  if (document.documentElement.dataset.theme !== "dark" &&
    (!el.closest(".news-workspace") || !window.matchMedia("(min-width: 961px) and (prefers-reduced-motion: no-preference)").matches)) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--spot-x", `${((e.clientX - r.left) / r.width) * 100}%`);
  el.style.setProperty("--spot-y", `${((e.clientY - r.top) / r.height) * 100}%`);
}
