"use client";

import { HIRE_ZOOM_SCRIPT } from "./hire-zoom";

/**
 * Injects the --hire-zoom script into initial HTML during SSR so the dashboard
 * does not flash at full size before scaling.
 *
 * React 19 / Next 16 warns when client-side rendering encounters an executable
 * <script> tag ("Scripts inside React components are never executed when
 * rendering on the client"). On the client (during hydration and client-side
 * navigation), we switch the tag type to "application/json" with suppressHydrationWarning
 * so React does not warn or attempt to execute it. HireChrome's useEffect
 * already handles dynamic zoom adjustments on the client.
 */
export function HireZoomScript() {
  const isClient = typeof window !== "undefined";

  return (
    <script
      type={isClient ? "application/json" : undefined}
      dangerouslySetInnerHTML={{ __html: HIRE_ZOOM_SCRIPT }}
      suppressHydrationWarning
    />
  );
}
