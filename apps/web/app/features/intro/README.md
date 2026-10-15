# Intro splash（开场）

1:1 post-beach recreation of [darc-room.com](https://www.darc-room.com/) Main photo wall for GAMEHOT.

## Motion (matched to original CSS)

- **GAME | HOT**: slide in large at mid-height (`scale(3)`), settle to bottom corners (`scale(1)`, `bottom: 6px`) — same model as InitialLoader DARC|ROOM (beach skipped).
- **Dual rings**: outer `80vw` / `40s linear infinite reverse`; inner `45vw` / `30s linear infinite` (`Main_circleRotate`).
- **Counter-rotate**: each photo runs `Main_imgRotate` (opposite direction/duration of its ring) so images stay upright.
- **8 slots/ring** at fixed `%` positions (`image--1…8`); square slots + `object-fit: contain`; default **opacity 0.2**, hover → 1.
- Center **「探索」**.

Extraction notes: `/workspace/darc-motion-extract/FINDINGS.md`.

## Behavior

- Only home `/` first session (`sessionStorage` `gamehot-intro-seen-v1`).
- Enter on 「探索」 not wired yet; 「跳过」 / `Esc` dismisses.
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
