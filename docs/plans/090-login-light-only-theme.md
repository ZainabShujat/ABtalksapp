# 090 — Login light-only theme

## 1. Goal

`/login` always renders in light mode. Dark-mode users keep their theme everywhere else; this page no longer shows black “Sign in with Google” on a dark button.

## 2. Current behavior

The login page already uses cream `bg-[#FBF9F7]`, but the card, shadcn Button, and `HUB_BUTTON_CLASS` (`text-black`) still follow `html.dark` from the root ThemeProvider. In dark mode the outline button fill goes dark while the label stays black.

## 3. Files to touch

- `src/app/login/layout.tsx` [new] — nested ThemeProvider with `forcedTheme="light"`
- `docs/plans/090-login-light-only-theme.md` [new]

## 4. Server vs Client

- `layout.tsx` — Server; wraps children in existing client `ThemeProvider`

## 5. Steps

1. Add login layout with `forcedTheme="light"`, `enableSystem={false}`, `disableTransitionOnChange`.
2. Do not call `setTheme("light")` (would persist and change the rest of the app).

## 6. Guardrails for Cursor (DO NOT)

- Do not change `HUB_BUTTON_CLASS` globally.
- Do not restyle the Google button or consent fields.
- Do not force light on `/register` or `/talent/login`.
- Do not edit `CLAUDE.md` / `project-context.md`.
- Do not touch middleware.

## 7. Verification

1. App in dark mode → `/login` is cream; Google label black on white.
2. Navigate away → dark theme still applies.
3. Light-mode `/login` looks the same as today.

## 8. Commit message

`fix(login): force light theme so Google sign-in stays readable`
