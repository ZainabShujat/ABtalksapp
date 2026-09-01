import type { Metadata } from "next";
import localFont from "next/font/local";
import {
  Fredoka,
  Gemunu_Libre,
  Instrument_Sans,
  Instrument_Serif,
  Outfit,
  Plus_Jakarta_Sans,
} from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { MotionProvider } from "@/components/shared/motion-provider";
import { SynergyProvider } from "@/components/shared/synergy-provider";
import { NotificationProvider } from "@/components/shared/notification-provider";
import { RouteThemeToaster } from "@/components/shared/route-theme-toaster";
import { AppFooter } from "@/components/shared/app-footer";
import { BottomNavGate } from "@/components/shared/bottom-nav-gate";
import { MainShell } from "@/components/shared/main-shell";
import { CookieConsentProvider } from "@/components/legal/cookie-consent-provider";
import { CookieConsentModal } from "@/components/legal/cookie-consent-modal";
import { ChatWidget } from "@/components/chatbot/ChatWidget";
import { isChatbotEnabled } from "@/lib/feature-flags";
import "./globals.css";

const archivo = localFont({
  src: [
    {
      path: "../fonts/archivo/archivo-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fonts/archivo/archivo-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../fonts/archivo/archivo-latin-800-normal.woff2",
      weight: "800",
      style: "normal",
    },
  ],
  variable: "--font-archivo",
  display: "swap",
});

const inter = localFont({
  src: [
    {
      path: "../fonts/inter/inter-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fonts/inter/inter-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../fonts/inter/inter-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../fonts/inter/inter-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../fonts/inter/inter-latin-800-normal.woff2",
      weight: "800",
      style: "normal",
    },
  ],
  variable: "--font-inter",
  display: "swap",
});

const hubSans = localFont({
  src: [
    {
      path: "../fonts/inter/inter-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fonts/inter/inter-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../fonts/inter/inter-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../fonts/inter/inter-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../fonts/inter/inter-latin-800-normal.woff2",
      weight: "800",
      style: "normal",
    },
  ],
  variable: "--font-hub-sans",
  display: "swap",
});

const hubSerif = localFont({
  src: [
    {
      path: "../fonts/instrument-serif/instrument-serif-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fonts/instrument-serif/instrument-serif-latin-400-italic.woff2",
      weight: "400",
      style: "italic",
    },
  ],
  variable: "--font-hub-serif",
  display: "swap",
});

const hubDisplay = localFont({
  src: [
    {
      path: "../fonts/gemunu-libre/gemunu-libre-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fonts/gemunu-libre/gemunu-libre-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-hub-display",
  display: "swap",
});

const hubQuote = localFont({
  src: [
    {
      path: "../fonts/jacques-francois/jacques-francois-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-hub-quote",
  display: "swap",
});

const hubFredoka = localFont({
  src: [
    {
      path: "../fonts/fredoka/fredoka-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fonts/fredoka/fredoka-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
  ],
  variable: "--font-hub-fredoka",
  display: "swap",
});

const hubInstrumentSans = localFont({
  src: [
    {
      path: "../fonts/instrument-sans/instrument-sans-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fonts/instrument-sans/instrument-sans-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../fonts/instrument-sans/instrument-sans-latin-700-italic.woff2",
      weight: "700",
      style: "italic",
    },
  ],
  variable: "--font-hub-instrument-sans",
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["500", "600", "700", "800"],
});

const fredoka = Fredoka({
  subsets: ["latin"],
  variable: "--font-fredoka",
  weight: ["400", "500", "600", "700"],
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  weight: ["400"],
  style: ["normal", "italic"],
});

/**
 * Instrument Sans for /workshop.
 *
 * The local `hubInstrumentSans` above ships only 400 and 700, but the design
 * leans on Medium (500) and SemiBold (600) throughout — and a missing 600 gets
 * substituted with 700, which is wide enough to push the community subhead
 * onto a third line. Loaded separately so the rest of the app keeps the
 * self-hosted files and their existing metrics.
 */
const workshopSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-workshop-sans",
  weight: ["400", "500", "600", "700"],
});

// Stat numerals on /workshop — the display face the Figma community
// section specifies (nodes 1:319-1:321).
const gemunuLibre = Gemunu_Libre({
  subsets: ["latin"],
  variable: "--font-gemunu",
  weight: ["500", "700"],
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "ABTalks",
  description: "Build your coding habit. Get discovered.",
};

const fontVars = [
  archivo.variable,
  inter.variable,
  hubSans.variable,
  hubSerif.variable,
  hubDisplay.variable,
  hubQuote.variable,
  hubFredoka.variable,
  hubInstrumentSans.variable,
  jakarta.variable,
  fredoka.variable,
  instrumentSerif.variable,
  outfit.variable,
  gemunuLibre.variable,
  workshopSans.variable,
].join(" ");

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fontVars} h-full antialiased`} suppressHydrationWarning>
      <body className={`${fontVars} min-h-full flex flex-col font-sans`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <CookieConsentProvider>
            {/* Above SynergyProvider on purpose: BottomNavGate renders one of
                the two bell triggers and sits outside SynergyProvider. */}
            <NotificationProvider>
              <SynergyProvider>
                <MotionProvider>
                  <MainShell>{children}</MainShell>
                </MotionProvider>
              </SynergyProvider>
              <AppFooter />
              <BottomNavGate />
              <RouteThemeToaster />
              <CookieConsentModal />
              {isChatbotEnabled() && <ChatWidget />}
            </NotificationProvider>
          </CookieConsentProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
