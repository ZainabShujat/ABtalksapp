# 166 — Password first on recruiter sign-in, emailed code second

Date: 2026-09-29 · Author: Sohail

---

## 1. Goal

`/recruiter-onboarding/signin` opens on the emailed-code flow, with password
tucked behind "Sign in with a password instead". Invert that: password is the
default, and the code becomes the secondary option below it.

---

## 2. Current behavior

`src/components/recruiter-onboarding/signin-screen.tsx`

```ts
const [screen, setScreen] = useState<Screen>("email");   // line 55
```

- **`email`** — the entry screen. "Welcome back", one Work email field, hint
  *"We'll email you a 6-digit code. No password needed."*, primary **Send code**.
  Footer: "Sign in with a password instead" (only when `passwordEnabled`) and
  "Don't have an account? Sign up".
- **`password`** — reached only from that link. Title *"Sign in with your
  password"*, and it **already carries both fields** — `si-pw-email` (Work
  email, `autoComplete="username"`) and `si-password`
  (`autoComplete="current-password"`). Footer: "Forgot it, or never set one?
  Email me a code to set a password". Its back arrow returns to `email`.
- `passwordEnabled` is already threaded from the page as
  `isEmailLoginEnabled()`.

So both screens exist and the password one is self-sufficient. This is a change
of default and of the links around it, not new UI.

### 2a. The finding that bears on the decision

Measured read-only on young-shadow:

```
recruiter profiles ............................ 10
recruiters with any password value ............  2
...of those, usable scrypt hashes .............  2
```

**Eight of ten recruiters have no password at all.** With password as the
default they land on a form they cannot complete and have to notice the code
link to get in. That is not a blocker — the link is exactly what this plan puts
below the form, plan 159's admin-created recruiters always get a password, and
adoption grows — but it is the cost, and it should be a known one.

### 2b. A security line this plan will not cross

It is tempting to soften 2a by telling the recruiter *"this account has no
password — use a code"*. **No.** That is account enumeration: it reveals which
addresses have accounts and their auth state to anyone who can type an email.
`authorizePassword` already calls `burnPasswordCheck` so that "no such user" and
"wrong password" take the same time — enumeration resistance here is
deliberate, and a message would undo it more cheaply than any timing attack.

The mitigation is affordance, not disclosure: after a failed password attempt,
make the code option visible in the error region. It says nothing about the
account.

### 2c. The flag

`passwordEnabled === false` means `authorizePassword` returns `null` for
everyone. Defaulting to password there would make sign-in impossible, so the
default must be conditional.

---

## 3. Files to touch

| File | | Note |
|---|---|---|
| `src/components/recruiter-onboarding/signin-screen.tsx` | `[edit]` | Default screen, the two footers, back-arrow and focus. |
| `src/features/hire/recruiter-signin.test.ts` | `[new]` | Pin the default, the fallback and the enumeration rule. |
| `package.json` | `[edit]` | `test:recruiter-signin`. |

No server change, no schema, no auth-path change. `authorizePassword`,
`authorizeEmailCode` and the providers in `auth.ts` are untouched — this is
which screen renders first.

---

## 4. Server vs Client

`SigninScreen` is already a Client Component and already receives
`passwordEnabled: boolean` from a Server Component. No new props, no new state,
nothing new across the boundary.

---

## 5. Steps

**S1. The default.**

```ts
// Password first (plan 166). Conditional, not absolute: with email login off
// `authorizePassword` refuses everyone, so the code flow has to remain the
// entry point or nobody can sign in at all.
const [screen, setScreen] = useState<Screen>(passwordEnabled ? "password" : "email");
```

**S2. The password screen becomes the entry.**

- Title and description take the welcome copy the `email` screen has today
  ("Welcome back" / "Pick up where you left off…"), so the first thing a
  returning recruiter reads does not change.
- `autoFocus` moves to `si-pw-email`.
- **No back arrow** when it is the entry screen — there is nothing behind it.
  `onBack` becomes conditional on having arrived from somewhere.
- Footer, in this order: **"Email me a 6-digit code instead"** (→ `email`),
  then the existing "Forgot it, or never set one?" reset link, then
  "Don't have an account? Sign up" — which today only exists on the `email`
  screen and would otherwise disappear from the entry point.

**S3. The code screen becomes secondary.**

- Its footer swaps "Sign in with a password instead" for a return to the
  password screen, still gated on `passwordEnabled`.
- Its back arrow returns to `password` when that is the entry screen.
- Its own copy is unchanged — it is still correct for what it does.

**S4. Failed-password affordance (2b).** When `submitPassword` sets an error,
render the "Email me a 6-digit code instead" control adjacent to the message as
well as in the footer. Same generic error text as today; only the route out
becomes easier to find.

**S5. Tests.** Source-level, in the style of the other suites here:

- The initial screen is `passwordEnabled ? "password" : "email"` — both branches.
- The password screen renders both `si-pw-email` and `si-password`, with
  `autoComplete` `username` / `current-password` intact (password managers
  depend on that pairing).
- A route to the code flow exists from the password screen, and a route back.
- "Sign up" is reachable from the entry screen.
- **No copy anywhere distinguishes "no password set" from "wrong password"** —
  assert the component contains no such string, so 2b cannot be undone by a
  well-meaning later edit.
- `authorizePassword` still calls `burnPasswordCheck` — the timing defence is
  not weakened by this change.

---

## 6. Guardrails (DO NOT)

- **DO NOT** make the default unconditional. With `ENABLE_EMAIL_LOGIN` off,
  password sign-in cannot work and the code flow must stay the entry.
- **DO NOT** tell the user whether an account exists or has a password, in copy,
  in an error, or by a different error for the two cases. See §2b.
- **DO NOT** touch `authorizePassword`, `authorizeEmailCode`, `src/auth.ts`,
  `auth.config.ts` or `middleware.ts`. This is a default, not an auth change.
- **DO NOT** remove the emailed-code flow or the reset flow. Eight of ten
  current recruiters depend on the code path to get in at all.
- **DO NOT** change `autoComplete` on either field, or split email and password
  across two steps — password managers fill the pair.
- **DO NOT** leave a back arrow on the entry screen.
- **DO NOT** drop "Don't have an account? Sign up" from the entry screen.
- **DO NOT** touch `src/features/notification/**`.

---

## 7. DB safety

None. No schema, no migration, no data change.

---

## 8. Verification

```
npx tsc --noEmit && npm run lint && npm run build
npm run test:recruiter-signin
```

Browser, `/recruiter-onboarding/signin`:

1. Loads on the password form, both fields, email focused, no back arrow.
2. A recruiter **with** a password signs in and lands on `/hire`.
3. A recruiter **without** one gets the generic failure, and the code option is
   visible without scrolling.
4. That link reaches the code flow; a code signs them in; the back arrow returns
   to password.
5. "Sign up" is present on the entry screen.
6. With `ENABLE_EMAIL_LOGIN=false`, the screen loads on the **code** flow and no
   password option is offered.
7. A password manager offers to fill both fields as one credential.
8. 375px: no horizontal scroll.

---

## 9. Commit message

```
feat(hire): recruiter sign-in defaults to password, code second

The signin screen opened on the emailed-code flow with password behind a
link. Password is now the default and the code is the option below it.
Both screens already existed and the password one already carried its own
email field, so this is the default and the links around it, not new UI.

Conditional on ENABLE_EMAIL_LOGIN: with it off authorizePassword refuses
everyone, so the code flow stays the entry point.

Deliberately NOT added: any message distinguishing "no password set" from
"wrong password". Eight of ten current recruiters have no password, which
makes that message tempting and makes it account enumeration.
burnPasswordCheck exists to stop exactly that being learnable by timing.
```

---

## 10. Ownership

```
TASK:    Default recruiter sign-in to password, code second
MODULE:  Recruiter onboarding (Zainab) × Authentication architecture (Sohail)
FILES:   src/components/recruiter-onboarding/signin-screen.tsx
         → .github/CODEOWNERS: /src/app/recruiter-onboarding/ @zainabshujat
```

```
CROSS-MODULE CHANGE REQUIRED

Owner:   Zainab (@zainabshujat) — recruiter onboarding
Module:  Recruiter registration / onboarding
Files:   src/components/recruiter-onboarding/signin-screen.tsx
Why:     The screen is hers. The auth behaviour behind it is mine and is
         unchanged — no provider, no authorize function and no session
         handling is touched.
Proposed: Change the initial screen and the secondary links. Both flows
         survive; nothing is removed.
Status:  Requested by Sohail 2026-09-29. Rule 8 review (authentication) is
         mine and is recorded in §2b. CODEOWNERS still requires her review.
```
