/**
 * Brand tokens + colour utilities for the `/workshop` surfaces.
 *
 * Palette comes from `docs/design-system.md` — the orange/cream system
 * (#E05226 on #FBF9F7), which is also what the workshop poster uses. It
 * replaces the blue values the Figma file (Aw3uPilErVzYc8C6sNsrpd) carried;
 * that file's GEOMETRY is still the source of truth, only its colours were
 * swapped.
 *
 * Two rules from the spec that constrain everything here:
 *   - no additional shades of orange beyond #E05226 / #C9411C / #A93617 and
 *     the #FFECE3 / #FFF5F0 / #FFF1E9 tints, so gradients and capsule fills
 *     are built from those plus neutrals;
 *   - only four font weights (400/500/600/700).
 *
 * `.dark` is placed on <html> by next-themes (`attribute="class"`, see
 * src/app/layout.tsx), so `.dark .wk-root` is all that is needed to flip.
 * The spec defines no dark mode; this is a derived warm-neutral counterpart.
 *
 * Rendered by both `/workshop` and `/workshop/events`.
 */
export default function WorkshopThemeStyles() {
  return (
    <style>{`
      .wk-root {
        /* Instrument Sans throughout. --font-workshop-sans carries
           400/500/600/700; the app-wide --font-hub-instrument-sans has only
           400/700, and a substituted 600 renders wide enough to reflow the
           community subhead. */
        font-family: var(--font-workshop-sans), var(--font-hub-instrument-sans),
          ui-sans-serif, system-ui, sans-serif;

        /* ---------- accents: same in both themes ---------- */
        --wk-a1: #e05226;
        --wk-a1-rgb: 224, 82, 38;
        --wk-a1-hover: #c9411c;
        --wk-a1-active: #a93617;
        --wk-a1-light: #ffece3;
        --wk-a1-light-rgb: 255, 236, 227;
        --wk-a1-deep: #c9411c;
        --wk-a2: #e05226;
        --wk-a2-rgb: 224, 82, 38;
        --wk-a3: #e05226;
        --wk-a3-light: #ffece3;
        --wk-a4: #fff1e9;
        --wk-a5: #fff5f0;
        --wk-ink: #111111;

        /* Primary gradient — the two approved oranges, nothing in between. */
        --wk-grad: linear-gradient(180deg, var(--wk-a1) 0%, var(--wk-a1-hover) 100%);
        /* Page wash: cream falling to peach. Painted once on .wk-root so the
           sections can sit transparent over it and never band at their seams. */
        --wk-page-grad: linear-gradient(180deg, #fbf9f7 0%, #fff5f0 45%, #fff1e9 100%);

        /* Hero card — dark in BOTH themes, as in the design. Charcoal rather
           than the old navy, to sit in the orange/cream system. */
        --wk-navy: #111111;
        --wk-navy-chip: #353535;
        --wk-navy-box: #262220;
        --wk-navy-box-border: #4b4b4b;

        /* Header and footer are charcoal bars in BOTH themes, bookending the
           cream page against the hero card's own #111111. They need their own
           text tokens because the page-level ones flip with the theme and
           would go dark-on-dark. */
        --wk-bar-bg: #111111;
        /* 0.64 is as sheer as this can go: against a pale cream page scrolling
           under, bar text still clears AA at 5.5:1, while 0.58 drops to 4.47
           and fails. */
        --wk-bar-bg-blur: rgba(17, 17, 17, 0.64);
        --wk-bar-border: #302a27;
        --wk-bar-text: #faf7f5;
        --wk-bar-muted: #b3aaa4;

        /* ---------- LIGHT (the spec's native mode) ---------- */
        --wk-bg: #fbf9f7;
        --wk-bg-alt: #fff1e9;
        --wk-surface: #ffffff;
        --wk-text: #111111;
        --wk-text-dim: #353535;
        --wk-text-faint: #4b4b4b;
        --wk-card-bg: #ffffff;
        --wk-card-border: #e0e0e0;
        --wk-hairline: #e0e0e0;
        --wk-chip: #ffece3;
        --wk-chip-strong: #e0e0e0;
        --wk-header-bg: rgba(251, 249, 247, 0.86);
        --wk-shadow: 0 4px 5px rgba(17, 17, 17, 0.14);
        /* Primary-CTA drop shadow, tinted with the deep orange rather than
           black — a neutral shadow reads grey and cold against cream. Stored
           as the whole drop-shadow() shorthand because it is consumed by the
           filter property, not box-shadow. */
        --wk-cta-shadow: drop-shadow(0 4px 2px rgba(169, 54, 23, 0.32));
        /* Generic depth on warm surfaces. */
        --wk-ink-a: 17, 17, 17;
        --wk-shadow-lg: 0 40px 90px -30px rgba(17, 17, 17, 0.28);
        --wk-grid-line: #e0e0e0;
        --wk-cell-text: #111111;
        --wk-cell-muted: #8f8f8f;
        --wk-muted: #8f8f8f;
        --wk-heading: #111111;
        --wk-placeholder: #8f8f8f;
        --wk-scrim: rgba(17, 17, 17, 0.55);
        --wk-inset-hi: rgba(17, 17, 17, 0.04);

        background: var(--wk-page-grad);
        background-attachment: fixed;
      }

      .dark .wk-root {
        --wk-page-grad: linear-gradient(180deg, #141110 0%, #1c1a19 55%, #241f1c 100%);
        --wk-bg: #141110;
        --wk-bg-alt: #241f1c;
        --wk-surface: #1c1a19;
        --wk-text: #faf7f5;
        --wk-text-dim: #d6cfca;
        --wk-text-faint: #b3aaa4;
        --wk-card-bg: #1c1a19;
        --wk-card-border: #3a3330;
        --wk-hairline: #302a27;
        --wk-chip: rgba(224, 82, 38, 0.16);
        --wk-chip-strong: rgba(255, 255, 255, 0.12);
        --wk-header-bg: rgba(20, 17, 16, 0.84);
        --wk-cta-shadow: drop-shadow(0 4px 2px rgba(0, 0, 0, 0.45));
        --wk-ink-a: 0, 0, 0;
        --wk-shadow: 0 18px 40px -18px rgba(0, 0, 0, 0.7);
        --wk-shadow-lg: 0 40px 100px -20px rgba(0, 0, 0, 0.85);
        --wk-grid-line: #302a27;
        --wk-cell-text: #faf7f5;
        --wk-cell-muted: #8a807a;
        --wk-muted: #b3aaa4;
        --wk-heading: #faf7f5;
        --wk-placeholder: #8a807a;
        --wk-scrim: rgba(10, 8, 7, 0.78);
        --wk-inset-hi: rgba(255, 255, 255, 0.06);
      }

      /* ---------- colour utilities ----------
         Two-class specificity (0,2,0) so they win over a bare Tailwind
         colour utility without needing !important anywhere. */
      .wk-root .wk-t       { color: var(--wk-text); }
      .wk-root .wk-dim     { color: var(--wk-text-dim); }
      .wk-root .wk-faint   { color: var(--wk-text-faint); }
      .wk-root .wk-hover-t { transition: color 0.2s ease; }
      .wk-root .wk-hover-t:hover { color: var(--wk-text); }
      .wk-root .wk-card    { background: var(--wk-card-bg); border: 1px solid var(--wk-card-border); }
      .wk-root .wk-chip    { background: var(--wk-chip); border: 1px solid var(--wk-card-border); }
      .wk-root .wk-hair    { border-color: var(--wk-hairline); }

      /* Primary CTA. Deliberately restrained: a 2px lift, a slightly deeper
         shadow and a 1px inner highlight — no glow, no scale. */
      .wk-root .wk-cta {
        background: var(--wk-grad);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
        filter: var(--wk-cta-shadow);
        transition: transform 0.18s ease, filter 0.18s ease;
      }
      .wk-root .wk-cta:hover {
        transform: translateY(-2px);
        filter: drop-shadow(0 8px 10px rgba(169, 54, 23, 0.34));
      }
      .wk-root .wk-cta:active { transform: translateY(0); }
      @media (prefers-reduced-motion: reduce) {
        .wk-root .wk-cta,
        .wk-root .wk-cta:hover { transform: none; transition: none; }
      }

      /* The shared ui/checkbox paints itself with the app-wide primary, which
         is still indigo. Base UI exposes data-slot / data-checked, so the
         workshop palette is scoped on here rather than forking the component.
         Three selectors deep (0,3,0) to beat its own utility classes. */
      .wk-root [data-slot="checkbox"] {
        border-color: var(--wk-card-border);
        background: var(--wk-surface);
      }
      .wk-root [data-slot="checkbox"][data-checked] {
        background-color: var(--wk-a1);
        border-color: var(--wk-a1);
        color: #ffffff;
      }
      .wk-root [data-slot="checkbox"]:focus-visible {
        border-color: var(--wk-a1);
        box-shadow: 0 0 0 3px rgba(var(--wk-a1-rgb), 0.35);
      }

      /* ThemeToggle is a shared ghost Button that takes its colour from the
         app-wide foreground — dark-on-dark once it sits on the charcoal bar.
         Scoped here rather than forking the component. */
      /* The one interactive date in the calendar. A ring that expands and
         fades, plus a small press — no colour change, no confetti. */
      .wk-root .wk-bday {
        position: relative;
        cursor: pointer;
        background: transparent;
        transition: transform 0.14s ease, background-color 0.14s ease;
      }
      .wk-root .wk-bday:hover { background: rgba(var(--wk-a1-rgb), 0.10); }
      .wk-root .wk-bday:active { transform: scale(0.92); }

      .wk-root .wk-bday-ring {
        position: absolute;
        inset: -1.5px;
        border-radius: 9999px;
        border: 1.5px solid var(--wk-a1);
        pointer-events: none;
        animation: wk-bday-ring 640ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
      }
      @keyframes wk-bday-ring {
        from { transform: scale(1); opacity: 0.6; }
        to   { transform: scale(2.7); opacity: 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        .wk-root .wk-bday { transition: none; }
        .wk-root .wk-bday:active { transform: none; }
        .wk-root .wk-bday-ring { animation: none; opacity: 0; }
      }

      /* Shared by the theme toggle and the notification bell, so the two
         icon buttons in the charcoal bar cannot drift apart. */
      .wk-root .wk-bar-toggle button,
      .wk-root .wk-bar-icon button {
        color: var(--wk-bar-text);
        border-radius: 9999px;
      }
      .wk-root .wk-bar-toggle button:hover,
      .wk-root .wk-bar-icon button:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #ffffff;
      }
    `}</style>
  );
}
