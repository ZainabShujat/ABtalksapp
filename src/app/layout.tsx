import type { Metadata } from "next";
import localFont from "next/font/local";
import { Outfit } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { MotionProvider } from "@/components/shared/motion-provider";
import { SynergyProvider } from "@/components/shared/synergy-provider";
import { NotificationProvider } from "@/components/shared/notification-provider";
import { RouteThemeToaster } from "@/components/shared/route-theme-toaster";
import { AppFooter } from "@/components/shared/app-footer";
import { BottomNavGate } from "@/components/shared/bottom-nav-gate";
import { SiteSearchGate } from "@/components/dashboard-hub/site-search-gate";
import { MainShell } from "@/components/shared/main-shell";
import { CookieConsentProvider } from "@/components/legal/cookie-consent-provider";
import { CookieConsentModal } from "@/components/legal/cookie-consent-modal";
import { GA4Loader } from "@/components/analytics/ga4-loader";
import { ChatWidget } from "@/components/chatbot/ChatWidget";
import { isChatbotEnabled } from "@/lib/feature-flags";
import "./globals.css";

/*
 * ABTalks UI Design System v2: two families only.
 *   Inter  — body and UI (self-hosted, 400/500/600/700)
 *   Outfit — headings (400/500/600/700)
 * The retired display, serif, mono and seven-segment faces are no longer loaded.
 */
// next/font requires literal options, so the file list is written out in full
// for each loader rather than shared through a constant.
const inter = localFont({
  src: [
    { path: "../fonts/inter/inter-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/inter/inter-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../fonts/inter/inter-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../fonts/inter/inter-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});

/** Alias kept for stylesheets that still read --font-hub-sans (same Inter files). */
const hubSans = localFont({
  src: [
    { path: "../fonts/inter/inter-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/inter/inter-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../fonts/inter/inter-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../fonts/inter/inter-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-hub-sans",
  display: "swap",
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

const fontVars = [inter.variable, hubSans.variable, outfit.variable].join(" ");

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
            <GA4Loader />
            {/* Above SynergyProvider on purpose: BottomNavGate renders one of
                the two bell triggers and sits outside SynergyProvider. */}
            <NotificationProvider>
              <SynergyProvider>
                <MotionProvider>
                  <SiteSearchGate>
                    <MainShell>{children}</MainShell>
                  </SiteSearchGate>
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
