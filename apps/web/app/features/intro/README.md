# Intro splash（开场）

1:1 post-beach recreation of [darc-room.com](https://www.darc-room.com/) Main photo wall for GAMEHOT.

## Motion (matched to original CSS)

- **GAME | HOT**: slide in large at mid-height (`scale(3)`), settle to bottom corners (`scale(1)`, `bottom: 6px`) — same model as InitialLoader DARC|ROOM (beach skipped).
- **Dual rings**: outer `80vw` / `40s linear infinite reverse`; inner `45vw` / `30s linear infinite` (`Main_circleRotate`).
- **Counter-rotate**: each photo runs `Main_imgRotate` (opposite direction/duration of its ring) so images stay upright.
- **8 slots/ring** at fixed `%` positions (`image--1…8`); square slots + `object-fit: contain`; default **opacity 0.2**.
- **Photo hover**: hovered cover stays sharp/bright; other covers blur (smooth transition).
- Center **「进入」**: hover/focus brightens all covers on both rings (CSS `:has`); click dismisses into the site.
- **Cursor**: system pointer hidden on the splash; a small solid bright-red circular dot follows the pointer (fine pointer only).

Extraction notes: `/workspace/darc-motion-extract/FINDINGS.md`.

## Behavior

- Only home `/` first session (`sessionStorage` `gamehot-intro-seen-v1`).
- Primary UX: click **「进入」** to dismiss. `Esc` remains as a hidden keyboard hatch (no visible Skip / Esc UI).
- Footer tagline: **游戏热点 · 精选资讯** (subtle, bottom-center; clear of GAME|HOT corners).
- Before the first paint, a head script covers eligible home visits with the splash background until the splash mounts. The splash loads with the app to avoid an extra hydration/chunk-download waterfall. Returning visits and other routes stay uncovered. The cover releases after 8 seconds if client scripts fail.
- Force replay: `/?intro=1`
- `prefers-reduced-motion`: settled marks + static rings.

## Assets

- `apps/web/public/intro/*.jpg` (~480×270 Steam headers)
- `images.ts` — first 16 of `INTRO_WALL` (8 big + 8 small)

## Preview

```bash
npm run dev:web
# http://127.0.0.1:3000/?intro=1
```
