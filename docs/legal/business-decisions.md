# ABTalks — Legal / product decisions (v1 defaults)

**Status:** Interim defaults for shipping Terms/Privacy/consent. Replace with counsel-confirmed values when available.  
**Date:** 2026-08-08

| Decision | Default locked for v1 | Notes |
|----------|----------------------|--------|
| Legal entity name | ABTalks (operating name); formal registered entity TBD | Update Privacy/ToS header when entity papers exist |
| Registered address | TBD — contact via email | Do not invent a street address |
| Country | India (primary) | US disclosures for cohort/program tracks |
| Privacy / rights contact | `team@abtalks.in` | Same as existing support; counsel may add `privacy@` later |
| Governing law / venue | Laws of India; disputes subject to courts in India | US users still see the same Terms; Privacy discloses US processors |
| Retention | Active account for life of service use; after confirmed deletion request, erase or anonymize within 30 days except (a) certificates kept as public credentials unless revoked, (b) financial/audit logs up to 24 months, (c) legal holds | Documented in Privacy |
| Talent-pool sharing | **Opt-in** via `recruiterVisibilityConsent` on program apply | Not mandatory for completing missions; required before appearing in `/talent` |
| `/r/[token]` contact fields | **Strip email and phone** from public report + PDF | LinkedIn/GitHub may remain; matches original plan 010 intent |
| Interview transcripts to recruiters | **Summary + scores only** on talent portal (no full transcript) | Reduces sensitivity; admin still has transcript |
| Age policy | **18+** attestation required on all signup funnels | |
| Marketing email | **Transactional only** (welcome, workshop, hackathon, reset) | No promo list without separate opt-in |
| Cookie banner | **Not required** for current first-party essential + attribution cookies | Revisit if third-party analytics added |
| Consent versioning | `TERMS`/`PRIVACY` version `2026-08-08` | Bump constants when legal MD changes |

These defaults unblock Phase 0–4 implementation. Counsel review should confirm before treating docs as final legal advice.

---

## v2 decisions — 2026-08-10 (plan 060)

| Decision | v2 value | Supersedes |
|----------|----------|------------|
| Entity identification | **Published** on `/terms`, `/privacy`, `/contact` as a Data Fiduciary block. Values held as `<<FILL: …>>` markers in `LEGAL_ENTITY` (`src/lib/legal-constants.ts`) until the real details are supplied | v1 row "Legal entity name" |
| Grievance Officer | **Published** — name, designation, email, address. Commitment: acknowledge within **24 hours**, resolve within **15 days** (IT Rules 2021 timeline, stricter than the E-Commerce Rules, so safe for both) | new |
| Cookie banner | **Required.** Blocking centre-screen chooser with Allow all / Limited / Deny that genuinely gates attribution cookies in middleware and third-party embeds | **Supersedes** the v1 row "Cookie banner: not required" |
| Cookie consent storage | `abtalks_consent` cookie only — **no DB row**. For anonymous visitors there is no identifier, and logging an IP per visitor is itself a privacy cost | new |
| Certificates | Explicitly disclaimed as **not accredited** qualifications (Terms §6) | new |
| Synergy Points | Explicitly **not currency**, no cash value, non-transferable; fulfilment India-only and discretionary (Terms §8) | new |
| Fees | Service is **free**; no payment instruments processed. Refund/cancellation terms deferred to point-of-purchase if paid offerings launch — this is why no `/refunds` page exists (Terms §9) | new |
| Indemnity | Added as counterpart to the existing liability cap (Terms §14) | new |
| Dispute resolution | **30 days' written notice** before proceedings, good-faith resolution attempt. Governing law India unchanged (Terms §16) | extends v1 "Governing law" |
| Hackathon removal logs | Disclosed explicitly: retain name, email, phone, college, graduation year post-deletion, capped at **24 months** | extends v1 "Retention" |
| DPDP rights | Added §13 grievance redressal (with escalation to the Data Protection Board) and §14 nomination to Privacy §10 | new |
| Consent versioning | `TERMS` / `PRIVACY` / `COOKIE_POLICY` version `2026-08-10` | supersedes v1 `2026-08-08` |

~~**Open — blocking production merge:** registered entity legal name, registered address, registration number, Grievance Officer name and designation.~~ **Resolved 2026-08-10 — see v3 below.**

---

## v3 decisions — 2026-08-10 (plan 061)

| Decision | v3 value | Supersedes |
|----------|----------|------------|
| Legal entity | **ABTalksOnAI**, Sole Proprietorship (Proprietary), proprietor **Suman Shukla**. Micro enterprise, major activity Services, NIC 62099. Udyam **UDYAM-UP-29-0250625** (registered 01 Aug 2026; incorporation 25 Jul 2026). Address: Crossing Republic, Ghaziabad, Uttar Pradesh 201016, India | Closes the v1 "TBD" and v2 `<<FILL>>` rows; expanded from full Udyam certificate 2026-08-10 |
| Not published | PAN, bank account number, IFSC, and the proprietor's personal mobile (and the certificate mailbox if different from product support) all appear on the Udyam certificate and are **deliberately excluded** from every public surface and from the repo. Publishing them invites impersonation and payment fraud | new |
| Grievance Officer contact | `team@abtalks.in` only. Name and registered address are published because a proprietorship's legal identity is the proprietor; the personal mobile is not | refines v2 |
| Cookie chooser placement | Small **bottom-right banner**, no overlay, no focus trap, page stays usable. Attribution cookies still wait for an explicit choice — ignoring the banner sets nothing | supersedes v2 "blocking centre modal" |
| Newsletter opt-in | Checkbox on all signup funnels, **pre-checked by default**. Stored in `NewsletterSubscription`. Excluded from the submit gate, so it can never block registration | new |

**Recorded risk — pre-ticked newsletter.** DPDP §6(1) requires consent given by "clear affirmative action"; a pre-ticked box is not that, and regulators elsewhere (GDPR Art. 4(11), *Planet49*) have held the same. This was raised with the owner on 2026-08-10 and the owner chose to keep the box pre-ticked. The Privacy Policy and Terms describe the behaviour accurately (including an explicit note in Privacy §3.1). **Counsel should confirm** before treating marketing as fully DPDP-compliant. Revisit if the Service takes EU/UK traffic or if a complaint is received.

**2026-08-11 polish (non-product-code):** Privacy Policy gained plain-English leads, Do Not Track disclosure, hosting log/IP language, DPDP-oriented lawful bases, concrete security bullets, and material-change notice (in-product re-accept + email when feasible). Version `2026-08-11`.

**Required before the first marketing email is sent:** a working one-click unsubscribe link in every campaign, honouring `NewsletterSubscription.subscribed`. Storing the opt-in is safe; sending without unsubscribe is not.
