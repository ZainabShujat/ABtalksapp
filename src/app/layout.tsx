import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme-provider";
import { MotionProvider } from "@/components/shared/motion-provider";
import { SynergyProvider } from "@/components/shared/synergy-provider";
import { NotificationProvider } from "@/components/shared/notification-provider";
import { Toaster } from "@/components/ui/sonner";
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

export const metadata: Metadata = {
  title: "ABTalks | 60 Days Challenge",
  description: "Build your coding habit. Get discovered.",
};

const fontVars = [
  archivo.variable,
  hubSans.variable,
  hubSerif.variable,
  hubDisplay.variable,
  hubQuote.variable,
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
          forcedTheme="light"
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
              <Toaster />
              <CookieConsentModal />
              {isChatbotEnabled() && <ChatWidget />}
            </NotificationProvider>
          </CookieConsentProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
