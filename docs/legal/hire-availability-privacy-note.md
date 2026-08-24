# Hire / Scout — candidate availability (privacy note)

> **Status:** Product note for implementers and privacy copy updates.  
> If `content/legal/privacy.md` lands on this branch later, fold this section in and bump `PRIVACY_VERSION`.

## New personal data category

When a candidate opts in via **Open to opportunities** (`CandidateAvailability`):

| Field | Purpose |
|---|---|
| `openToWork` | Master switch — default false |
| Expected salary min/max + currency | Matching to recruiter compensation bands |
| Notice period (days) | Matching to recruiter timing |
| Preferred work mode | Onsite / hybrid / remote / flexible |
| Preferred cities + open to relocate | Location fit |

## Who sees it

- **Approved recruiters only**, and only when matching via Scout / hire filters.
- Program members must also have set `recruiterVisibilityConsentAt` (AND gate) to appear in Scout results at all.
- Not shown on public marketing pages or unauthenticated routes.

## Lawful basis / product rules

- Purely **opt-in**. No pre-ticked open-to-work.
- Fully editable and revocable; turning `openToWork` off removes the candidate from availability-filtered results immediately.
- Scout never invents salary/notice when the row is missing — cards show “availability not shared”.

## Action for legal publish

1. Add this category + purpose to the public Privacy Policy.
2. Bump `PRIVACY_VERSION` so existing users re-accept (when that system is on the branch).
