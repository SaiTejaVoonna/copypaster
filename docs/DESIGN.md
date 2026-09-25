# CopyPaster design system (v2.0)

All styling lives in the `<style>` block of `index.html`, built on tokens at the top.

## Tokens
- **Type:** `--font`, `--font-display`, `--mono`; sizes `--fs-2xs` … `--fs-3xl`; weights `--fw-*`.
- **Space:** 4px grid, `--s-1` (4px) … `--s-10` (40px).
- **Shape:** radii `--r-xs` … `--r-2xl`, `--r-full`.
- **Controls:** heights `--h-xs` (24) … `--h-lg` (40), `--h-touch` (44).
- **Motion:** `--t-fast` / `--t-med` / `--t-slow`, `--ease`. Everything that moves is switched off by `prefers-reduced-motion`.
- **Colour** (per theme): `--bg`, `--bg-sidebar`, `--surface-1..3`, `--elevated`, `--line`, `--line-strong`, `--text`, `--text-2`, `--text-3`, `--accent`, `--danger`, `--success`, `--warning`, plus a colour and `-soft` tint for each kind: note, command, link, image, password.

## Themes
`html[data-theme]` is `light` or `dark`. The saved choice is `light`, `dark` or `system`; a tiny script in `<head>` applies it before first paint, and "system" follows the device live.

## Components
Buttons (`.btn`, `.primary`, `.ghost`, `.danger`, `.icon-btn`), inputs, chips (`.chip`, `.on`), switches, list rows (type tile, title + time, preview line, meta pills), popovers and context menus, action sheets, the New Item command menu, dialogs, the command palette, toasts and the Settings layout all use the tokens above.

## Layout
- **Desktop (> 900px):** sidebar | list | editor. The editor shows a Details column when it's at least 760px wide (a container query).
- **Tablet (721–900px):** the sidebar becomes a drawer; list | editor.
- **Phone (≤ 720px):** one pane at a time, a bottom tab bar, a floating + button, bottom sheets, and Settings as list → section.
