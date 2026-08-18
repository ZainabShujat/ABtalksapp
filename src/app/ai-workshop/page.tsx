import type { Metadata } from "next";
import Link from "next/link";
import { Calendar, Clock, MapPin, Tag, Target } from "lucide-react";
import WorkshopHeader from "@/components/workshop/Header";
import RegistrationForm from "@/components/workshop/RegistrationForm";
import TopicsSection from "@/components/workshop/TopicsSection";
import ScrollToTop from "@/components/workshop/ScrollToTop";
import CountdownTimer from "@/components/workshop/CountdownTimer";
import CursorGlow from "@/components/workshop/CursorGlow";
import AutoScrollToForm from "@/components/workshop/AutoScrollToForm";
import HackathonPromoModal from "@/components/workshop/HackathonPromoModal";
import CommunityStats from "@/components/workshop/CommunityStats";
import UpcomingEvents from "@/components/workshop/UpcomingEvents";
import { auth } from "@/auth";
import {
  getRegistrableEvent,
  istTodayKey,
} from "@/components/workshop/events-data";
import { getWorkshopPrefill } from "@/features/workshop/get-prefill";
import { getMyRegistration } from "@/features/workshop/registration-status";
import { getWorkshopConfig } from "@/lib/workshop-supabase";

export const metadata: Metadata = {
  title: "ABTalks | Workshops Every week",
  description:
    "Join ABTalks' FREE 1-Hour Live LinkedIn Workshop on YouTube Live. Build a recruiter-ready profile, post content that actually gets seen, and use AI tools to stay consistent.",
  keywords:
    "LinkedIn, personal branding, LinkedIn profile, headline, About section, content strategy, LinkedIn posts, hooks, AI content creation, ChatGPT, Canva, scheduling, LinkedIn growth, analytics, networking, workshop, ABTalks",
  openGraph: {
    title: "ABTalks | Workshops Every week",
    description: "Join the FREE 1-Hour Live LinkedIn & Personal Branding Workshop",
    type: "website",
  },
};

export default async function AIWorkshopPage() {
  // This page stays PUBLIC — the marketing content, countdown and event list must
  // render for logged-out cold traffic. Only the form section below is gated.
  const [config, session] = await Promise.all([getWorkshopConfig(), auth()]);

  const event = getRegistrableEvent(istTodayKey());
  const userId = session?.user?.id ?? null;

  const [alreadyRegistered, prefill] = userId
    ? await Promise.all([
        event
          ? getMyRegistration(userId, event.id).then((r) => r !== null)
          : Promise.resolve(false),
        getWorkshopPrefill(userId),
      ])
    : [false, null];

  return (
    <div
      className="wk-root relative min-h-screen"
      style={{
        background: "var(--wk-bg)",
        color: "var(--wk-text)",
        overflowX: "clip",
      }}
    >
      <style>{`
        /* Brand palette — mirrors --primary (var(--color-accent-500)) / AI-domain violet (var(--color-accent-500))
           from globals.css. Scoped to this page; the app theme is untouched. */
        .wk-root {
          --wk-bg: var(--color-ink-900);
          --wk-surface: var(--color-ink-900);
          --wk-text: var(--color-ink-100);
          --wk-text-dim: var(--color-ink-400);

          --wk-a1: var(--color-accent-500);
          --wk-a1-rgb: 99, 102, 241;
          --wk-a1-light: var(--color-accent-400);
          --wk-a1-light-rgb: 129, 140, 248;
          --wk-a1-deep: var(--color-accent-600);

          --wk-a2: var(--color-accent-500);
          --wk-a2-rgb: 139, 92, 246;
          --wk-a3: var(--color-accent-400);
          --wk-a3-light: var(--color-accent-300);
          --wk-a4: var(--color-accent-400);

          --wk-grad: linear-gradient(135deg, var(--wk-a1) 0%, var(--wk-a2) 100%);
        }

        html { scroll-behavior: smooth; }
        @keyframes wk-float-a {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(40px, -30px) scale(1.08); }
        }
        @keyframes wk-float-b {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-30px, 40px) scale(1.1); }
        }
        @keyframes wk-hero-in {
          from { opacity: 0; transform: translateY(22px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes wk-badge-shine {
          0% { background-position: 200% center; }
          100% { background-position: -200% center; }
        }
        @keyframes wk-drift {
          0%   { transform: translateY(20px); opacity: 0; }
          15%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: translateY(-140px); opacity: 0; }
        }
        @keyframes wk-twinkle {
          0%, 100% { opacity: 0.25; }
          50% { opacity: 0.9; }
        }
        .wk-hero-item { animation: wk-hero-in 0.7s cubic-bezier(0.22,1,0.36,1) both; }
        .wk-particle { position: absolute; border-radius: 9999px; will-change: transform, opacity; }

        /* Hero CTA — breathing glow + shine sweep */
        @keyframes hero-cta-glow {
          0%, 100% { box-shadow: 0 12px 34px -10px rgba(var(--wk-a2-rgb),0.55), inset 0 1px 0 rgba(255,255,255,0.25); }
          50%      { box-shadow: 0 18px 44px -8px rgba(var(--wk-a2-rgb),0.85), 0 0 24px 2px rgba(var(--wk-a1-rgb),0.35), inset 0 1px 0 rgba(255,255,255,0.3); }
        }
        @keyframes hero-cta-shine {
          0%, 55% { transform: translateX(-130%) skewX(-15deg); }
          100%    { transform: translateX(130%) skewX(-15deg); }
        }
        .hero-cta {
          position: relative;
          overflow: hidden;
          animation: hero-cta-glow 2.6s ease-in-out infinite;
        }
        .hero-cta::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.38) 50%, transparent 60%);
          transform: translateX(-130%) skewX(-15deg);
          animation: hero-cta-shine 3.6s ease-in-out infinite;
          pointer-events: none;
        }
        .hero-cta:hover .cta-arrow { transform: translateX(4px); }
        .cta-arrow { display: inline-block; transition: transform 0.2s ease; }
      `}</style>

      {/* ---------- Ambient background ---------- */}
      <div className="pointer-events-none fixed inset-0 z-0">
        {/* aurora orbs */}
        <div
          style={{
            position: "absolute",
            top: "-160px",
            left: "-120px",
            width: "560px",
            height: "560px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(var(--wk-a1-rgb),0.28), transparent 65%)",
            filter: "blur(60px)",
            animation: "wk-float-a 16s ease-in-out infinite",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "10%",
            right: "-160px",
            width: "600px",
            height: "600px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(var(--wk-a2-rgb),0.22), transparent 65%)",
            filter: "blur(70px)",
            animation: "wk-float-b 20s ease-in-out infinite",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "-200px",
            left: "30%",
            width: "620px",
            height: "620px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(var(--wk-a1-rgb),0.16), transparent 65%)",
            filter: "blur(80px)",
            animation: "wk-float-a 24s ease-in-out infinite",
          }}
        />
        {/* grid overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage:
              "radial-gradient(ellipse 80% 50% at 50% 0%, hsl(var(--foreground)) 40%, transparent 100%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 80% 50% at 50% 0%, hsl(var(--foreground)) 40%, transparent 100%)",
          }}
        />

        {/* floating particles (top / hero region) */}
        <div className="absolute inset-x-0 top-0 h-[720px]">
          {[
            { l: "12%", t: "22%", s: 4, c: "var(--color-accent-500)", d: 9, delay: 0 },
            { l: "24%", t: "58%", s: 3, c: "var(--color-accent-500)", d: 12, delay: 1.5 },
            { l: "40%", t: "16%", s: 5, c: "var(--color-accent-400)", d: 11, delay: 0.8 },
            { l: "58%", t: "48%", s: 3, c: "var(--color-accent-400)", d: 10, delay: 2.2 },
            { l: "72%", t: "26%", s: 4, c: "var(--color-accent-600)", d: 13, delay: 0.4 },
            { l: "86%", t: "60%", s: 3, c: "var(--color-accent-500)", d: 9.5, delay: 1.1 },
            { l: "50%", t: "70%", s: 4, c: "var(--color-accent-500)", d: 12.5, delay: 2.8 },
            { l: "32%", t: "38%", s: 2, c: "hsl(var(--background))", d: 8, delay: 1.9 },
          ].map((p, i) => (
            <span
              key={i}
              className="wk-particle"
              style={{
                left: p.l,
                top: p.t,
                width: p.s,
                height: p.s,
                background: p.c,
                boxShadow: `0 0 8px 1px ${p.c}`,
                animation: `wk-drift ${p.d}s ease-in-out ${p.delay}s infinite, wk-twinkle ${p.d / 3}s ease-in-out ${p.delay}s infinite`,
              }}
            />
          ))}
        </div>
      </div>

      <CursorGlow />
      <AutoScrollToForm />
      <HackathonPromoModal />

      {/* ---------- Content ---------- */}
      <div className="relative z-10">
        <WorkshopHeader />

        {/* ================= HERO ================= */}
        <section className="mx-auto w-full max-w-4xl px-4 pt-8 pb-0 text-center sm:pt-10">
          <div className="wk-hero-item" style={{ animationDelay: "0.05s" }}>
            
          </div>

          <h1
            className="wk-hero-item mx-auto mt-5 max-w-3xl text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-[56px]"
            style={{ animationDelay: "0.12s" }}
          >
            Enhance {" "}
            <span
              style={{
                background:
                  "linear-gradient(120deg, var(--wk-a1-light) 0%, var(--wk-a2) 55%, var(--wk-a3) 100%)",
                backgroundSize: "200% auto",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                animation: "wk-badge-shine 6s linear infinite",
              }}
            >
              LinkedIn & AI Mock Interview
            </span>{" "}
              Workshop
          </h1>

          <p
            className="wk-hero-item mx-auto mt-4 max-w-xl text-base leading-relaxed text-white/55 sm:text-lg"
            style={{ animationDelay: "0.2s" }}
          >
            Rebuild your LinkedIn profile so recruiters actually find you, then run live AI mock interviews that grill you and score your answers.
          </p>

          {/* date + countdown */}
          <div
            className="wk-hero-item mx-auto mt-6 flex flex-col items-center gap-4"
            style={{ animationDelay: "0.28s" }}
          >
            <div
              className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-none px-4 py-2 text-[13px] font-medium text-white/70"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                <Calendar size={14} strokeWidth={1.75} />
                {config.webinarDate}
              </span>
              <span className="text-white/20">•</span>
              <span className="inline-flex items-center gap-1.5">
                <Clock size={14} strokeWidth={1.75} />
                {config.webinarTime}
              </span>
            </div>

            <CountdownTimer targetUtc={config.webinarTargetUtc} />
          </div>

          {/* CTAs */}
          <div
            className="wk-hero-item mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row"
            style={{ animationDelay: "0.36s" }}
          >
            <a
              href="#register"
              className="hero-cta w-full rounded-none px-8 py-3.5 text-[15px] font-semibold text-white transition-transform hover:-translate-y-0.5 sm:w-auto"
              style={{
                background: "var(--wk-grad)",
              }}
            >
              <span className="relative z-10">
                Reserve Your Free Seat <span className="cta-arrow"></span>
              </span>
            </a>
            <a
              href="#curriculum"
              className="w-full rounded-none px-8 py-3.5 text-[15px] font-semibold text-white/80 transition-colors hover:text-white sm:w-auto"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.12)",
              }}
            >
              View Curriculum
            </a>
          </div>

          {/* trust chips */}
          <div
            className="wk-hero-item mt-6 flex flex-wrap items-center justify-center gap-2.5"
            style={{ animationDelay: "0.44s" }}
          >
            {[
              { Icon: Clock, text: "1 Hour Live" },
              { Icon: MapPin, text: "Live on YouTube" },
              { Icon: Tag, text: "100% Free" },
              { Icon: Target, text: "Beginner Friendly" },
            ].map((c) => (
              <span
                key={c.text}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-white/60"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <c.Icon size={14} strokeWidth={1.75} />
                {c.text}
              </span>
            ))}
          </div>
        </section>

        {/* ================= REGISTRATION ================= */}
        <section className="px-0 py-24 sm:py-32">
          <div id="register" className="scroll-mt-24">
            {/* Primitives only across the Server→Client boundary — never the
                session object or a WorkshopEvent (it carries a LucideIcon). */}
            <RegistrationForm
              whatsappLink={config.whatsappLink}
              isSignedIn={Boolean(userId)}
              sessionEmail={session?.user?.email ?? null}
              sessionName={session?.user?.name ?? null}
              registrationOpen={Boolean(event)}
              alreadyRegistered={alreadyRegistered}
              prefillName={prefill?.name ?? null}
              prefillPhone={prefill?.phone ?? null}
              prefillOrganization={prefill?.organization ?? null}
              prefillGraduationYear={prefill?.graduationYear ?? null}
              prefillRole={prefill?.role ?? null}
              isExistingMember={prefill?.isExistingMember ?? false}
            />
          </div>
        </section>

        {/* ================= CURRICULUM ================= */}
        <div id="curriculum" className="scroll-mt-20">
          <TopicsSection />
        </div>

        {/* ================= COMMUNITY ================= */}
        <CommunityStats />

        {/* ================= FINAL CTA ================= */}
        <section className="mx-auto w-full max-w-3xl px-4 pb-20 text-center">
          <div
            className="relative overflow-hidden rounded-3xl px-6 py-12 sm:px-12"
            style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.09)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
            }}
          >
            <div
              className="absolute inset-x-0 top-0 h-px"
              style={{
                background:
                  "linear-gradient(to right, transparent, rgba(var(--wk-a1-rgb),0.7), rgba(var(--wk-a2-rgb),0.7), transparent)",
              }}
            />
            <h3 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
              Ready to design smarter?
            </h3>
            <p className="mx-auto mt-3 max-w-md text-sm text-white/50 sm:text-base">
              Seats are limited and fill fast. Grab yours before registration
              closes.
            </p>
            <div className="mt-7">
              <ScrollToTop />
            </div>
          </div>
        </section>

        {/* ================= UPCOMING ================= */}
        <UpcomingEvents />

        {/* ================= FOOTER ================= */}
        <footer className="border-t border-white/5 px-4 py-8 text-center">
          <nav
            className="mb-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[13px] text-white/45"
            aria-label="Legal"
          >
            <Link href="/terms" className="hover:text-white/80 hover:underline">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-white/80 hover:underline">
              Privacy
            </Link>
            <Link href="/cookies" className="hover:text-white/80 hover:underline">
              Cookies
            </Link>
            <Link href="/contact" className="hover:text-white/80 hover:underline">
              Contact
            </Link>
          </nav>
          <p className="text-[13px] text-white/35">
            © {new Date().getFullYear()} ABTalks · AI Workshop
          </p>
        </footer>
      </div>
    </div>
  );
}
