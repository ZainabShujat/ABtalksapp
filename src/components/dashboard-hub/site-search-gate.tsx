import { Suspense, type ReactNode } from "react";
import { getSiteSearchItems } from "@/features/dashboard/get-site-search-items";
import { SiteSearchProvider } from "@/components/dashboard-hub/site-search-host";

async function SiteSearchGateInner({ children }: { children: ReactNode }) {
  const items = await getSiteSearchItems();
  return <SiteSearchProvider items={items}>{children}</SiteSearchProvider>;
}

export function SiteSearchGate({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={children}>
      <SiteSearchGateInner>{children}</SiteSearchGateInner>
    </Suspense>
  );
}
