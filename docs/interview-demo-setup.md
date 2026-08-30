# AI Cohort Interview — local demo setup

How to run the interview agent locally and walk through it end to end.
Everything here runs against a **disposable test database**. Nothing touches
production.

---

## 1. Prerequisites

- Node 20+ and npm
- The repo, on branch **`interview-agent-2.0`**
- A `.env.local` (ask Zainab — it carries the keys below)

Required in `.env.local`:

| Variable | Why |
|---|---|
| `DATABASE_SAMPLE_URL` | The throwaway Neon test DB. **This is the only DB the demo touches.** |
| `AUTH_SECRET` | Session signing. Any long random string. |
| `ENABLE_DEV_AUTH=true` | Shows the email/password form on `/login`. Without it there is no way to sign in locally. |
| `GROQ_API_KEY` | The interviewer's reasoning model, and speech-to-text. |
| `ENABLE_INTERVIEW_VOICE=true` | Enables the voice UI. |

> `DATABASE_URL` in `.env.local` points at **production**. The demo scripts and
> the dev server below deliberately ignore it and bind `DATABASE_SAMPLE_URL`
> instead. Do not "fix" this by pointing `DATABASE_URL` at the test DB.

---

## 2. Install

```bash
npm install
```

```bash
npx prisma generate
```

---

## 3. Seed a demo candidate

Creates a candidate who has passed **all 31 cohort days**, so both the Day 15
and Day 31 interviews are unlocked and untaken.

```bash
npx tsx scripts/seed-demo-candidate.ts
```

It is idempotent — safe to re-run. It refuses to write if the target database
looks production-shaped, and it only touches its own candidate. Existing demo
members and their reports are never reset or deleted.

---

## 4. Run the app

```bash
npm run dev:interview
```

Use **this**, not `npm run dev`. It binds the test database, verifies by row
count that the target is disposable, and refuses to boot otherwise. You should
see:

```
  users         3
  verdict       disposable test database — safe
  llm provider  groq
  voice         enabled
```

Then open http://localhost:3000

---

## 5. Logins

| Account | State | Use for |
|---|---|---|
| `demo-day31@abtalks.dev` / `demo-day31` | 31/31 days passed, **no interviews taken** | Running a full interview |
| `demo-day15@abtalks.dev` / `demo-day15` | Day 15 + Day 31 both completed | Viewing finished reports |
| `interview-e2e@abtalks.dev` / `e2e-dev-password` | Day 15 completed (score 26) | Viewing a finished report |

Use **`demo-day31`** to record or test a live interview. The other two are spent
— each milestone can only be taken once — and re-running the seed will not
reset them by design.

---

## 6. Walkthrough

**Reaching the interview**

1. Sign in at `/login`.
2. You land on `/program/dashboard`.
3. Scroll to the **bottom** of the page — past Modules and VIEW STATS.
4. Click the **Mock Interview** row to expand it (collapsed by default).
5. The card shows Day 15 and Day 31, each with its own state. Click
   **Take Interview**.

Or go straight there:
- `/program/cohort-interview/DAY_15`
- `/program/cohort-interview/DAY_31`

**The interview**

Intro → Consent → Microphone check → Ready → Live.

Answer out loud, or use **"Prefer typing?"** at the bottom — the typed path
goes through exactly the same agent, so it is fine for testing.

Things worth trying:
- Answer one question well and one with *"I don't know"* — the interviewer
  should accept the gap and move on, not accuse you of going off-topic.
- Answer a question strongly and it will escalate to a harder follow-up.
- Say something unrelated and it should steer you back.
- Past halfway, **End interview** still scores what you answered and generates
  the report.

**The report**

- `/program/cohort-interview/DAY_15/report`
- `/program/cohort-interview/DAY_31/report`

Also reachable from the dashboard card via **View report** once a milestone is
completed.

---

## 7. Known caveats

**`BYPASS_DAY_LOCKS`** — if this is `true` in `.env.local`, *every* milestone
shows as unlocked regardless of days completed, which hides the real unlock
rule. Set it to `false` to see genuine behaviour. The seeded `demo-day31`
account is unlocked legitimately, so it works either way.

**An interview can only be taken once per milestone.** Abandoned and invalid
attempts do not consume it, but a completed one does. If you burn both
milestones on the demo account, seed a new one by changing `EMAIL`/`NAME` at
the top of `scripts/seed-demo-candidate.ts` and re-running.

**Text-to-speech** falls back to the browser's built-in voice — the server TTS
route returns 503 unless `OPENAI_API_KEY` is set. Speech-to-text works via
Groq. A `503` on `/api/interview/tts` in the console is expected, not a bug.

**Minimum duration** — an interview under 3 minutes is marked INVALID and
produces no report. It does not consume the milestone, so you can retry.

---

## 8. Troubleshooting

| Symptom | Cause |
|---|---|
| `Sign-in failed (Configuration)` | `ENABLE_DEV_AUTH` is not `true`, or `AUTH_SECRET` is missing. |
| Login form has no email/password fields | Same — `ENABLE_DEV_AUTH` is not set. |
| Redirected to the marketing page | Not signed in, or the account is not an enrolled program member. |
| `DATABASE_SAMPLE_URL is not set` | Missing from `.env.local`. |
| Server refuses to start, "looks like production" | `DATABASE_SAMPLE_URL` is pointed at a real database. Do not override the guard. |
| Interview says "already completed" | That milestone is spent on that account. Use `demo-day31`, or seed a new candidate. |
