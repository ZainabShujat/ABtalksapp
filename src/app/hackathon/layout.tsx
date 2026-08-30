import "@fontsource/dseg7-classic/400.css";
import "@fontsource/dseg7-classic/700.css";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { HackathonHeader } from "@/components/hackathon/hackathon-header";

const bitcount = localFont({
  src: [
    {
      path: "../../fonts/bitcount-prop-single/bitcount-prop-single-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-hackathon-display",
  display: "swap",
});

const plexMono = localFont({
  src: [
    {
      path: "../../fonts/ibm-plex-mono/ibm-plex-mono-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../fonts/ibm-plex-mono/ibm-plex-mono-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../fonts/ibm-plex-mono/ibm-plex-mono-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../../fonts/ibm-plex-mono/ibm-plex-mono-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-hackathon-mono",
  display: "swap",
});

export default function HackathonLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${bitcount.variable} ${plexMono.variable} min-h-screen bg-black text-white antialiased`}
    >
      <HackathonHeader />
      {children}
    </div>
  );
}
