import { CertificateType, Domain } from "@prisma/client";

/**
 * Crockford-style alphabet: no 0/O/1/I/L. 31^5 ≈ 28.6M ids per track —
 * plenty for a 1,500-student platform, and unambiguous when read off a printed page.
 */
export const CERT_ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CERT_ID_LENGTH = 5;
export const CERT_ID_PATTERN = /^ABT-[A-Z]{2}-[23456789A-HJ-NP-Z]{5}$/;

type CertificateTypeConfig = {
  /** The XX segment of ABT-XX-XXXXX. */
  code: string;
  title: string;
  subtitle: string;
  /** Used to build the download filename. ASCII, hyphenated, no spaces. */
  fileSlug: string;
};

export const CERTIFICATE_TYPES: Record<CertificateType, CertificateTypeConfig> = {
  CLAUDE_CHALLENGE: {
    code: "CC",
    title: "60-Day Claude Challenge",
    subtitle: "Claude AI Mastery Track",
    fileSlug: "Claude-Challenge",
  },
  HACKATHON: {
    code: "HK",
    title: "ViCoDathon 2026",
    subtitle: "India's AI Vibe Coding Hackathon",
    fileSlug: "ViCoDathon-2026",
  },
  COHORT: { code: "CH", title: "ABTalks Cohort", subtitle: "Cohort Program", fileSlug: "Cohort" },
  WORKSHOP: { code: "WS", title: "ABTalks Workshop", subtitle: "Workshop", fileSlug: "Workshop" },
};

type RGB = { r: number; g: number; b: number };

type CenteredStamp = {
  align: "center";
  centerXRatio: number;
  baselineYRatio: number;
  fontSize: number;
  bold: boolean;
  color: RGB;
};

type LeftStamp = {
  align: "left";
  xRatio: number;
  baselineYRatio: number;
  fontSize: number;
  bold: boolean;
  color: RGB;
};

export type CertificateTextStamp = CenteredStamp | LeftStamp;

export type CertificateLayout = {
  certificateId: CertificateTextStamp;
  issuedOn: CertificateTextStamp;
  name: CenteredStamp & { minFontSize: number; maxWidthRatio: number };
  qr: { xRatio: number; yRatio: number; sizeRatio: number };
  /** Null when the artwork has no "verify authenticity at" line (hackathon). */
  verifyText: LeftStamp | null;
};

/**
 * Overlay layout, expressed as FRACTIONS of the template page box.
 *
 * Derived by measuring the approved template artwork (landscape, orange/near-black
 * "CERTIFICATE OF COMPLETION" design). Ratios rather than absolute points because the
 * artwork's aspect ratio (~1.57) is NOT A4 landscape (1.415) or Letter landscape
 * (1.294) — it is a custom page box, so hard-coded points would be wrong.
 *
 * The template has FIVE stamp targets, not three:
 *   1. CERTIFICATE ID value  — under the top-right "CERTIFICATE ID" label (left of badge)
 *   2. ISSUED ON value       — under the bottom-right "ISSUED ON" label
 *   3. Recipient name        — between "PROUDLY PRESENTED TO" and the orange rule
 *   4. QR code               — under the bottom-right "SCAN TO VERIFY" label
 *   5. Verify URL            — under the bottom-right "Verify authenticity at" label
 *
 * Note the artwork's content column is centred at ~0.512, not 0.5 — the decorative
 * "AI" head graphic on the left pushes the text block slightly right. Centring the
 * name on 0.5 makes it visibly misaligned against "CERTIFICATE" above it.
 *
 * !!! These are STARTING values measured off the artwork render. Confirm against the
 * real PDF's MediaBox with the debug grid (see Step 9a) before shipping. !!!
 * Origin is bottom-left (pdf-lib convention), y grows upward.
 */
export const CLAUDE_CERT_LAYOUT = {
  /** Shared centre of the artwork's content column. */
  contentCenterXRatio: 0.512,

  issuedOn: {
    align: "center" as const,
    /** Bottom-right, centred under the "ISSUED ON" label. Nudged 22px left (page w=960). */
    centerXRatio: 0.737083,
    baselineYRatio: 0.085,
    fontSize: 10,
    bold: false,
    color: { r: 0.07, g: 0.09, b: 0.15 },
  },
  certificateId: {
    align: "center" as const,
    /** Top-right under "CERTIFICATE ID". Nudged up by 5% of page width (48pt / h=639.75). */
    centerXRatio: 0.76125,
    baselineYRatio: 0.928815,
    fontSize: 10,
    bold: true,
    color: { r: 0.07, g: 0.09, b: 0.15 },
  },
  name: {
    align: "center" as const,
    /** Matches the content column, NOT the page centre. */
    centerXRatio: 0.512,
    /** Sits in the gap between "PROUDLY PRESENTED TO" and the orange rule. */
    baselineYRatio: 0.59,
    /** Locked by product owner. Auto-shrinks only if a name would overflow. */
    fontSize: 30,
    minFontSize: 16,
    /** Must not run past the orange rule (which spans ~0.30–0.72 of page width). */
    maxWidthRatio: 0.55,
    bold: true,
    color: { r: 0.07, g: 0.09, b: 0.15 },
  },
  qr: {
    /** Bottom-left corner of QR. Nudged 8px right, 10px up (page 960×639.75). */
    xRatio: 0.850200,
    yRatio: 0.117627,
    sizeRatio: 0.082,
  },
  verifyText: {
    align: "left" as const,
    /** LEFT-aligned under "Verify authenticity at" — this label is bottom-right in the
     *  artwork, not bottom-centre. Do not centre this on the page. */
    xRatio: 0.835,
    baselineYRatio: 0.09,
    fontSize: 7,
    bold: false,
    color: { r: 0.42, g: 0.45, b: 0.5 },
  },
} as const;

/** Sampled straight out of the ViCoDathon artwork's content stream. */
const HK_INK: RGB = { r: 1, g: 1, b: 1 };            // #FFFFFF — values
/** Artwork palette reference — ViCoDathon label purple. */
export const HK_ACCENT: RGB = { r: 0.549, g: 0.3216, b: 1 }; // #8C52FF — the artwork's label purple

/**
 * ViCoDathon 2026 overlay layout. Page box is 1113 × 795 pt with MediaBox y = 8.04,
 * so ratios are `absolutePdfCoordinate / pageSize` (see the coordinate note in plan 065).
 *
 * FOUR stamp targets, all anchored to artwork the template already draws:
 *   1. Certificate ID — centred UNDER the "CERTIFICATE ID" label (top right)
 *   2. Date of issue  — left-aligned to the RIGHT of "DATE OF ISSUE", same baseline
 *   3. Recipient name — centred on the underline rule, sitting just above it
 *   4. QR code        — centred on and directly ABOVE the "SCAN TO VERIFY" label
 *
 * There is no verify-URL text line in this artwork; `verifyText` is null.
 */
export const HACKATHON_CERT_LAYOUT = {
  certificateId: {
    align: "center",
    /** Label spans x 948.7–1039.6 → centre 994.2. 994.2 / 1113. */
    centerXRatio: 0.89321,
    /** 17 pt below the label baseline (751.3) → 734.3. 734.3 / 795. */
    baselineYRatio: 0.92365,
    fontSize: 12,
    bold: true,
    color: HK_INK,
  },
  issuedOn: {
    align: "left",
    /** 12 pt right of the label's right edge (~139.3) → 151.3. 151.3 / 1113. */
    xRatio: 0.13594,
    /** SAME baseline as the "DATE OF ISSUE" label (64.6). 64.6 / 795. */
    baselineYRatio: 0.08126,
    fontSize: 10,
    bold: false,
    color: HK_INK,
  },
  name: {
    align: "center",
    /** Underline rule spans x 313.5–814.5 → centre 564.0. 564.0 / 1113. */
    centerXRatio: 0.50674,
    /** 14 pt above the rule (y ≈ 381) so descenders clear it → 395. 395 / 795. */
    baselineYRatio: 0.49686,
    fontSize: 30,
    minFontSize: 16,
    /** Rule is 501 pt wide; 460 pt keeps ~20 pt of air at each end. 460 / 1113. */
    maxWidthRatio: 0.41330,
    bold: true,
    color: HK_INK,
  },
  qr: {
    /** Bottom-left corner. Centred on the label centre (1008.05) → 1008.05 − 38. */
    xRatio: 0.87157,
    /** 12 pt above the label's cap height (63.5 + ~6.8 ≈ 70.3) → 82.3. 82.3 / 795. */
    yRatio: 0.10352,
    /** 76 pt square. 76 / 1113. */
    sizeRatio: 0.06829,
  },
  verifyText: null,
} as const;

export const CERTIFICATE_LAYOUTS: Partial<Record<CertificateType, CertificateLayout>> = {
  CLAUDE_CHALLENGE: CLAUDE_CERT_LAYOUT,
  HACKATHON: HACKATHON_CERT_LAYOUT,
};

/**
 * Per-type template source. Env overrides are DELIBERATELY per type — `.env.local`
 * already sets CERTIFICATE_TEMPLATE_PATH to the Claude artwork, so a shared override
 * would render hackathon certificates on the wrong template.
 */
export const CERTIFICATE_TEMPLATES: Partial<
  Record<CertificateType, { defaultPath: string; urlEnv: string; pathEnv: string }>
> = {
  CLAUDE_CHALLENGE: {
    defaultPath: "public/certificates/claude-certificate-template.pdf",
    urlEnv: "CERTIFICATE_TEMPLATE_URL",
    pathEnv: "CERTIFICATE_TEMPLATE_PATH",
  },
  HACKATHON: {
    defaultPath: "public/certificates/vicodathon-certificate.pdf",
    urlEnv: "HACKATHON_CERTIFICATE_TEMPLATE_URL",
    pathEnv: "HACKATHON_CERTIFICATE_TEMPLATE_PATH",
  },
};

export function certificateDomainLabel(domain: Domain | null): string {
  switch (domain) {
    case Domain.CLAUDE: return "Claude AI Mastery";
    case Domain.SE: return "Software Engineering";
    case Domain.DS: return "Data Science";
    case Domain.AI: return "Artificial Intelligence";
    default: return "—";
  }
}
