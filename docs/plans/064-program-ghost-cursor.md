# 064 — GhostCursor on Open-right-now cards

## Goal

Mount React Bits GhostCursor on each of the four program cards under “Open right now”, tinted with that card’s existing `program.color`.

## Files

- `src/components/landing/hub/ghost-cursor.tsx` `[new]`
- `src/components/landing/landing-hub.tsx` `[edit]` — one instance per card
- `src/components/landing/hub/landing-hub.css` `[edit]` — `.hub-program-card-body` stacking
- `package.json` / lockfile `[edit]` — `three`, `@types/three`

## Commit message

`Add per-card GhostCursor effect to Open right now program cards`
