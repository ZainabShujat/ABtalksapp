export const HACKATHON = {
  eventId: "vicodathon-2-2026",
  name: "ABTalks Vibe Code Hackathon",
  tagline: "48 hours. No boilerplate. Just you, your ideas, and AI.",
  // Manual kill switch (cutover / emergency). Time gate is registrationClosesUtc.
  // Postponed 2026-09-24: this event is on hold while we run the Video Editors
  // hackathon (see docs/plans/154-hackathon-video-editors.md and branch
  // `Hackathon-Video-Editor`). Flipping this to false shuts every write path
  // (registration action bails before any welcome email fires) and swaps the
  // header CTA to a disabled "Registration closed" state.
  registrationOpen: false,
  maxTeamSize: 3,

  // Event: Fri 25 Sep 2026 → Sun 27 Sep 2026 (IST). All UTC instants below
  // are Kolkata local time minus 5:30.
  kickoffUtc: "2026-09-25T14:30:00Z", // Fri 25 Sep · 8:00 PM IST
  deadlineUtc: "2026-09-27T15:15:00Z", // Sun 27 Sep · 8:45 PM IST
  kickoffLabel: "Friday, 25 Sep · 8:00 PM IST",
  deadlineLabel: "Sunday, 27 Sep · 8:45 PM IST",
  resultsLabel: "Winners announced: Friday, 2 Oct",
  // Open while now < this instant (Fri 25 Sep 6:00 PM IST).
  registrationClosesUtc: "2026-09-25T12:30:00Z",
  registrationClosesLabel: "Registration closes Friday, 25 Sep · 6:00 PM IST",
  briefsHeading: "Problem Statements",

  // Leaders can edit the roster (remove a teammate) up to and including
  // Tue 22 Sep IST — 3 days before kickoff. This instant is 23 Sep 00:00 IST,
  // so the whole of 22 Sep is still open. Admins are never subject to this lock.
  rosterLockUtc: "2026-09-22T18:30:00Z", // Tue 22 Sep 11:59 PM IST (= 23 Sep 00:00 IST)
  rosterLockLabel: "Tuesday, 22 Sep · 11:59 PM IST",

  whatsappLink: "https://chat.whatsapp.com/EOLFgfatwID1mZNtHj4WCv?s=cl&p=a&mlu=0&ilr=4",
  discordLink: "https://discord.gg/Zk8XRJ3J7",
  prizes: [] as { place: string; reward: string }[], // empty ⇒ "announced soon" state

  // TODO(organizer): paste the real Breeth redeem URL before kickoff.
  // Breeth supplied two capped links: 5,000 redemptions and 3,000 redemptions.
  // Ship the 5k link. If it exhausts mid-event, swap this one value to the 3k
  // link — no other file changes.
  // Reserve (3k): "PASTE_3K_LINK_HERE"
  sponsor: {
    name: "Breeth",
    kicker: "Sponsor",
    heading: "Your apps get memory",
    blurb:
      "Breeth is a memory layer for AI agents. Your app writes what happened, and it remembers — across sessions, across users, across the whole weekend. Every participant gets Breeth Pro, free.",
    capabilities: [
      {
        title: "Persistent memory, no infra",
        body: "One API call to save, one to search. No embeddings, no vector database, no retrieval pipeline to build in 48 hours.",
      },
      {
        title: "Plugs into Claude Code and Cursor",
        body: "Breeth ships an MCP server, so your AI assistant can read and write project memory while it codes for you.",
      },
      {
        title: "Remembers why, not just what",
        body: "Facts carry the reasoning behind them, and old beliefs fade as they're contradicted. Build things that notice when a user changes their mind.",
      },
    ],
    siteUrl: "https://thebreeth.com",
    docsUrl: "https://docs.thebreeth.com",
    redeemUrl: "https://www.thebreeth.com/event/abtalks-vibe-code-hackathon-breeth-ai-memory",
    redeemLabel: "Claim your Breeth Pro access",
    // TODO(organizer): confirm reward with Breeth before announcing.
    prizeTitle: "Best use of Breeth",
    prizeReward: "Sponsor track prize: reward announced soon.",
  },

  steps: [
    {
      title: "Register",
      body: "Sign up solo or create a team of up to 3. It takes under two minutes and it's free.",
    },
    {
      title: "Join the WhatsApp group",
      body: "After you register, hop into the event group. Kickoff updates and the problem statement land there first.",
    },
    {
      title: "Build for 48 hours",
      body: "From Friday kickoff to Sunday deadline, describe what you want, let AI write the code, ship something real.",
    },
    {
      title: "Submit before the deadline",
      body: "Public GitHub repo, live deployed URL, and your AI-usage log. Late submissions don't count.",
    },
  ],

  timeline: [
    {
      title: "Kickoff",
      body: "Problem statement drops. Clock starts. Build anything, product judgment over typing speed.",
    },
    {
      title: "Midpoint check-in",
      body: "Optional pulse check in WhatsApp. Share progress, unblock teammates, keep shipping.",
    },
    {
      title: "Deadline",
      body: "Repos locked. Repo public, deploy live, PROMPTS.md (or chat exports) in place.",
    },
    {
      title: "Results",
      body: "Winners announced. Criteria: originality, polish, and how well you steered the AI.",
    },
  ],

  deliverables: [
    {
      title: "Public GitHub repo",
      body: "Your full project source, public and cloneable. Private repos won't be judged.",
    },
    {
      title: "Live deployed URL",
      body: "Something we can open, Vercel, Netlify, or any reachable host. A README-only demo doesn't count.",
    },
    {
      title: "AI-usage log",
      body: "A PROMPTS.md in the repo, or exported chat transcripts. This is how we verify the build was genuinely vibe-coded.",
    },
  ],

  rules: [
    {
      title: "Solo or teams of up to 3",
      body: "Enter alone or create a team. One shareable 6-character code joins teammates, max three people total.",
    },
    {
      title: "Open to Indian college students",
      body: "1st year through recent grads. One entry per person, enforced by email.",
    },
    {
      title: "Build starts at kickoff",
      body: "No head starts. Anything pre-built must be disclosed in your submission notes.",
    },
    {
      title: "Fair play",
      body: "Use any AI coding tool. Don't submit someone else's work as yours. Be kind in the community chat.",
    },
  ],

  judging: [
    {
      title: "Product judgment",
      body: "Did you pick a sharp problem and ship a coherent answer?",
    },
    {
      title: "Prompting skill",
      body: "Does the AI-usage log show deliberate steering, not blind copy-paste?",
    },
    {
      title: "Polish & deploy",
      body: "Does it run live, look intentional, and explain itself clearly?",
    },
  ],

  faq: [
    {
      q: "Do I need a team?",
      a: "No. Solo entries are welcome. If you want teammates, create a team and share the 6-character code, up to 3 people total.",
    },
    {
      q: "What if I can't code?",
      a: "That's the point of vibe coding. You describe the product; tools like Cursor or Claude Code write the implementation. Judgment and prompting matter more than typing speed.",
    },
    {
      q: "Is it free?",
      a: "Yes. Registration and entry are completely free.",
    },
    {
      q: "What counts as vibe coding?",
      a: "You steer with natural language and AI writes most of the code. Hand-typing every line defeats the theme, we check your AI-usage log.",
    },
    {
      q: "Can I use a template?",
      a: "Starter templates and boilerplates are fine if you disclose them. The bulk of the product should be built during the 48 hours.",
    },
    {
      q: "How are winners picked?",
      a: "Judges weigh originality, how well you steered the AI (via your prompt log), and whether the live deploy actually works.",
    },
  ],
} as const;

/** Open when the kill switch is on and now is before registrationClosesUtc. */
export function isHackathonRegistrationOpen(now: number = Date.now()): boolean {
  if (!HACKATHON.registrationOpen) return false;
  return now < new Date(HACKATHON.registrationClosesUtc).getTime();
}
