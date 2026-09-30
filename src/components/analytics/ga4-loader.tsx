"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useCookieConsent } from "@/components/legal/cookie-consent-provider";
import {
  computeGa4State,
  shouldReloadOnDowngrade,
} from "@/components/analytics/ga4-loader-gate";
import type { CookieChoice } from "@/lib/cookies";
import { isProduction } from "@/lib/env";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function GA4Loader() {
  const pathname = usePathname();
  const { choice, ready } = useCookieConsent();
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  const isProd = isProduction();
  const prevChoiceRef = useRef<CookieChoice | null | undefined>(undefined);

  useEffect(() => {
    if (!ready) return;
    const prev = prevChoiceRef.current;
    prevChoiceRef.current = choice;
    if (!isProd || !measurementId) return;
    if (shouldReloadOnDowngrade(prev, choice)) {
      // next/script does not remove injected <script> tags on unmount, so a
      // pure re-render can't unload gtag.js. A full reload is the only way to
      // honour plan §11 ("Never load GA4 in production without a granted
      // analytics_storage signal") after a limited/all → essential downgrade.
      window.location.reload();
    }
  }, [ready, choice, isProd, measurementId]);

  const state = computeGa4State({ ready, choice, isProd, measurementId });
  if (state.render === "null") return null;

  const initScript = `window.dataLayer = window.dataLayer || [];
function gtag(){window.dataLayer.push(arguments);}
window.gtag = gtag;
gtag('consent', 'default', ${JSON.stringify(state.defaults)});
gtag('js', new Date());
// send_page_view: true is safe here — the strict gate in computeGa4State
// means this loader only mounts when the user has affirmatively granted
// analytics_storage, so every page_view fires with a legitimate consent
// signal (never a cookieless ping under our gate).
gtag('config', ${JSON.stringify(state.measurementId)}, { anonymize_ip: true, send_page_view: true });${
    state.defaults.ad_storage === "granted"
      ? "\ngtag('config', 'AW-18456978326');"
      : ""
  }`;

  // The public home page loads gtag.js for Google Ads. A second library
  // request on the same page is a second Google tag; queue the GA4 config
  // on the dataLayer the Ads snippet already owns.
  const adsTagProvidesGtag = pathname === "/";

  return (
    <>
      <Script id="ga4-consent-default" strategy="afterInteractive">
        {initScript}
      </Script>
      {adsTagProvidesGtag ? null : (
        <Script
          id="ga4-gtag"
          strategy="afterInteractive"
          src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(state.measurementId)}`}
        />
      )}
    </>
  );
}
