/**
 * Darc-room–inspired opening splash for GAMEHOT.
 * Choreography: GAME | HOT slide in → shrink to bottom corners → elliptical Steam thumb wall + 「探索」.
 * Enter is not wired yet; Escape / 「跳过」 dismisses for now. Seen once per session (sessionStorage).
 * Force replay: ?intro=1
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { INTRO_WALL } from "./images";

const STORAGE_KEY = "gamehot-intro-seen-v1";
const ENTER_MS = 900;
const SETTLE_MS = 1300;
const EXIT_MS = 480;
/** Ambient orbit period — matches darc-room Main_imgRotate (~40s). */
const ORBIT_S = 40;

type Phase = "enter" | "settle" | "ambient" | "exit";

type Slot = {
  src: string;
  alt: string;
  /** Unit circle coords before ellipse scale (−1…1). */
  ux: number;
  uy: number;
  scale: number;
};

function buildSlots(): Slot[] {
  const n = INTRO_WALL.length;
  return INTRO_WALL.map((thumb, i) => {
    const t = (Math.PI * 2 * i) / n + Math.sin(i * 1.7) * 0.06;
    const radial = 0.9 + ((i * 13) % 11) / 80;
    return {
      ...thumb,
      ux: Math.cos(t) * radial,
      uy: Math.sin(t) * radial,
      scale: 0.78 + ((i * 37) % 17) / 50,
    };
  });
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

export function IntroSplash() {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<Phase>("enter");
  const [reduce, setReduce] = useState(false);
  const slots = useMemo(buildSlots, []);

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

  if (!active) return null;

  const settled = phase === "settle" || phase === "ambient" || phase === "exit";
  const showWall = phase === "ambient" || phase === "exit";
  const exiting = phase === "exit";

  return (
    <div
      className={`intro-splash${exiting ? " is-exit" : ""}${reduce ? " is-reduced" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="GAMEHOT 开场"
      data-phase={phase}
    >
      <div className="intro-splash__bg" aria-hidden="true" />

      <div className={`intro-splash__mark intro-splash__mark--left${settled ? " is-settled" : ""}`} aria-hidden="true">
        GAME
      </div>
      <div className={`intro-splash__mark intro-splash__mark--right${settled ? " is-settled" : ""}`} aria-hidden="true">
        HOT
      </div>

      <div className={`intro-splash__stage${showWall ? " is-on" : ""}`} aria-hidden={showWall ? undefined : true}>
        <div className="intro-splash__orbit" style={{ "--intro-orbit": `${ORBIT_S}s` } as CSSProperties}>
          {slots.map((slot) => (
            <div
              key={slot.src}
              className="intro-splash__slot"
              style={
                {
                  "--ux": String(slot.ux),
                  "--uy": String(slot.uy),
                  "--s": String(slot.scale),
                } as CSSProperties
              }
            >
              <div className="intro-splash__card">
                <img src={slot.src} alt="" width={480} height={270} loading="eager" decoding="async" draggable={false} />
              </div>
            </div>
          ))}
        </div>

        <div className="intro-splash__center">
          <p className="intro-splash__kicker">GAMEHOT</p>
          <p className="intro-splash__cta">探索</p>
        </div>
      </div>

      <button type="button" className="intro-splash__skip" onClick={dismiss}>
        跳过
        <span className="intro-splash__skip-hint">Esc</span>
      </button>
    </div>
  );
}
