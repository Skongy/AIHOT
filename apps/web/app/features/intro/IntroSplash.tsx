/**
 * Darc-room–inspired opening splash for GAMEHOT.
 *
 * Motion model matched to https://www.darc-room.com/ Main_* CSS (post-beach):
 * - GAME | HOT slide in large at mid-height, then shrink to bottom corners
 *   (InitialLoader: scale(3) @ bottom:50% → scale(1) @ bottom:6)
 * - Dual concentric rings: outer 80vw / 40s reverse, inner 45vw / 30s
 * - 8 fixed %-slots per ring; each image counter-rotates so it stays upright
 * - Square slots + object-fit:contain; default opacity 0.2
 * - Photo hover: hovered cover stays sharp/bright; others blur
 * - Center 「进入」 hover brightens both rings; click 「进入」 dismisses
 *
 * Escape dismisses as a hidden keyboard hatch (no visible Skip UI).
 * Seen once per session. Force: ?intro=1
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { INTRO_WALL } from "./images";

const STORAGE_KEY = "gamehot-intro-seen-v1";
const ENTER_MS = 900;
const SETTLE_MS = 1300;
const EXIT_MS = 480;

/** Exact slot percentages from Main_image--1…8 on darc-room. */
const SLOT_POS = [
  { left: "50%", top: "0%" },
  { left: "15%", top: "15%" },
  { left: "0%", top: "50%" },
  { left: "15%", top: "85%" },
  { left: "50%", top: "100%" },
  { left: "85%", top: "85%" },
  { left: "100%", top: "50%" },
  { left: "85%", top: "15%" },
] as const;

type Phase = "enter" | "settle" | "ambient" | "exit";

type RingSlot = {
  src: string;
  alt: string;
  left: string;
  top: string;
};

function buildRings(): { big: RingSlot[]; small: RingSlot[] } {
  const thumbs = INTRO_WALL.slice(0, 16);
  while (thumbs.length < 16) {
    thumbs.push(INTRO_WALL[thumbs.length % INTRO_WALL.length]!);
  }
  const big = SLOT_POS.map((pos, i) => ({ ...thumbs[i]!, ...pos }));
  const small = SLOT_POS.map((pos, i) => ({ ...thumbs[i + 8]!, ...pos }));
  return { big, small };
}

function forceIntro(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("intro") === "1";
  } catch {
    return false;
  }
}

function alreadySeen(): boolean {
  if (typeof window === "undefined") return true;
  if (forceIntro()) return false;
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function finePointer(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function IntroSplash() {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<Phase>("enter");
  const [reduce, setReduce] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const rings = useMemo(buildRings, []);

  useEffect(() => {
    if (alreadySeen()) return;
    const still = prefersReducedMotion();
    setReduce(still);
    setActive(true);
    if (still) {
      setPhase("ambient");
      return;
    }
    setPhase("enter");
    const t1 = window.setTimeout(() => setPhase("settle"), ENTER_MS);
    const t2 = window.setTimeout(() => setPhase("ambient"), ENTER_MS + SETTLE_MS);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  const dismiss = useCallback(() => {
    setPhase((p) => {
      if (p === "exit") return p;
      markSeen();
      return "exit";
    });
  }, []);

  useEffect(() => {
    if (phase !== "exit") return;
    const t = window.setTimeout(() => setActive(false), EXIT_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = prev;
    };
  }, [active, dismiss]);

  /* Custom period-sized solid red cursor on the splash only (fine pointer). */
  useEffect(() => {
    if (!active || !finePointer()) return;
    const el = cursorRef.current;
    const root = rootRef.current;
    if (!el || !root) return;

    const move = (e: PointerEvent) => {
      el.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0) translate(-50%, -50%)`;
      if (!el.classList.contains("is-on")) {
        el.classList.add("is-on");
        root.classList.add("has-cursor");
      }
    };
    const leave = () => {
      el.classList.remove("is-on");
      root.classList.remove("has-cursor");
    };

    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("mouseleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("mouseleave", leave);
    };
  }, [active]);

  if (!active) return null;

  const settled = phase === "settle" || phase === "ambient" || phase === "exit";
  const showWall = phase === "ambient" || phase === "exit";
  const exiting = phase === "exit";

  return (
    <div
      ref={rootRef}
      className={`intro-splash${exiting ? " is-exit" : ""}${reduce ? " is-reduced" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="GAMEHOT 开场"
      data-phase={phase}
    >
      <div className="intro-splash__bg" aria-hidden="true" />

      <div
        ref={cursorRef}
        className="intro-splash__cursor"
        aria-hidden="true"
      />

      <div
        className={`intro-splash__mark intro-splash__mark--left${settled ? " is-settled" : ""}`}
        aria-hidden="true"
      >
        GAME
      </div>
      <div
        className={`intro-splash__mark intro-splash__mark--right${settled ? " is-settled" : ""}`}
        aria-hidden="true"
      >
        HOT
      </div>

      <div className={`intro-splash__stage${showWall ? " is-on" : ""}`} aria-hidden={showWall ? undefined : true}>
        {/* Outer ring — Main_imagesCircleBig: 80vw, 40s reverse */}
        <div className="intro-splash__ring-wrap">
          <div className="intro-splash__ring intro-splash__ring--big">
            {rings.big.map((slot, i) => (
              <div
                key={`big-${slot.src}-${i}`}
                className="intro-splash__photo intro-splash__photo--big"
                style={{ left: slot.left, top: slot.top }}
              >
                <img src={slot.src} alt="" width={160} height={160} loading="eager" decoding="async" draggable={false} />
              </div>
            ))}
          </div>
        </div>

        {/* Inner ring — Main_imagesCircleSmall: 45vw, 30s */}
        <div className="intro-splash__ring-wrap">
          <div className="intro-splash__ring intro-splash__ring--small">
            {rings.small.map((slot, i) => (
              <div
                key={`small-${slot.src}-${i}`}
                className="intro-splash__photo intro-splash__photo--small"
                style={{ left: slot.left, top: slot.top }}
              >
                <img src={slot.src} alt="" width={120} height={120} loading="eager" decoding="async" draggable={false} />
              </div>
            ))}
          </div>
        </div>

        <div className="intro-splash__center">
          <button type="button" className="intro-splash__cta" onClick={dismiss}>
            「进入」
          </button>
        </div>
      </div>

      <p className="intro-splash__footer" aria-hidden="true">
        游戏热点 · 精选资讯
      </p>
    </div>
  );
}
