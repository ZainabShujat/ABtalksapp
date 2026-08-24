/**
 * Client-safe legal constants.
 *
 * Kept separate from `legal.ts` because that module reads from disk
 * (`node:fs/promises`) — importing it from a Client Component pulls a Node
 * built-in into the browser bundle and fails the build. Anything a client
 * needs lives here; `legal.ts` re-exports it so server callers are unaffected.
 */

/** Bump these when `content/legal/*.md` versions change; consent rows store them. */
export const TERMS_VERSION = "2026-08-10";
/** Bump when content/legal/privacy.md version changes (triggers reconsent). */
export const PRIVACY_VERSION = "2026-08-11";

/** Bumping this invalidates every stored cookie choice and re-prompts. */
export const COOKIE_POLICY_VERSION = "2026-08-10";

export type LegalDocKind = "terms" | "privacy" | "cookies";

/**
 * Single source of truth for entity identification, required under India's
 * DPDP Act 2023, the IT Rules 2021, and the Consumer Protection (E-Commerce)
 * Rules 2020.
 *
 * `content/legal/terms.md` and `content/legal/privacy.md` repeat these values
 * literally because markdown cannot import — update all three together.
 *
 * Only what the law requires published goes here: entity name, type,
 * proprietor, registered address, registration number, and a contact address.
 * PAN, bank account, IFSC and personal phone numbers appear on the Udyam
 * certificate but must NEVER be added — publishing them invites impersonation
 * and payment fraud.
 */
export const LEGAL_ENTITY = {
  /** Udyam / certificate: NAME OF ENTERPRISE */
  name: "ABTalksOnAI",
  /** Udyam: Owner Name */
  proprietor: "Suman Shukla",
  /** Type of Organisation — Proprietary */
  entityType: "Sole Proprietorship (Proprietary)",
  /** Public trading / brand name */
  tradingName: "ABTalks",
  /** Unit name on Udyam certificate */
  unitName: "ABTalksOnAI",
  /** Micro / Small / Medium classification on Udyam */
  enterpriseScale: "Micro",
  /** MAJOR ACTIVITY */
  majorActivity: "Services",
  /**
   * National Industry Classification (NIC) as printed on the Udyam certificate.
   * 62 → 6209 → 62099 (IT and computer service activities n.e.c.).
   */
  industryClassification:
    "NIC 62099 — Other information technology and computer service activities n.e.c.",
  /** DATE OF UDYAM REGISTRATION (certificate) */
  udyamRegistrationDate: "2026-08-01",
  /** DATE OF INCORPORATION / REGISTRATION OF ENTERPRISE */
  incorporationDate: "2026-07-25",
  /** Official address of enterprise (public block only — no mobile) */
  address:
    "Crossing Republic, Ghaziabad, Uttar Pradesh 201016, India",
  registrationNumber: "UDYAM-UP-29-0250625",
  registrationType: "Udyam Registration (MSME)",
  /**
   * Public contact for the Service. The Udyam certificate also lists a
   * different mailbox — we publish the product support address only.
   * Never publish PAN, bank account, IFSC, or the personal mobile from the certificate.
   */
  email: "team@abtalks.in",
  grievanceOfficer: {
    name: "Suman Shukla",
    designation: "Proprietor and Grievance Officer",
    email: "team@abtalks.in",
    acknowledgeWithin: "24 hours",
    resolveWithin: "15 days",
  },
} as const;
