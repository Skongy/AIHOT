# Intro splash（开场）

Darc-room 风格的全屏开场：`GAME` / `HOT` 从左右滑入并缩到底角字标，随后椭圆 Steam 缩略图墙缓慢环绕，中心显示「探索」。

## 行为（当前）

- 仅首页 `/`（精选）首次会话展示（`sessionStorage` 键 `gamehot-intro-seen-v1`）。
- **未接线「点击探索进入」**；临时用右上角「跳过」或 `Esc` 关闭，便于开发与浏览站内其他内容。
- 强制重放：`/?intro=1`
- 尊重 `prefers-reduced-motion`：直接落到落位字标 + 静态图墙。

## 资源

- 缩略图：`apps/web/public/intro/*.jpg`（约 480×270，从 Steam header 居中裁切）。
- 清单：`images.ts`（墙面约用 20 张）。

## 预览

```bash
npm run dev:web
# 打开 http://127.0.0.1:3000/?intro=1
```
