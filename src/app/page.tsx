import Script from "next/script";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getLandingState } from "@/features/landing/get-landing-state";
import { getRecruiterState } from "@/features/talent-pool/recruiter-registration";
import { isClaudeEnabled, isDatabricksEnabled } from "@/lib/feature-flags";
import { LandingPage } from "@/components/landing/site/landing-page";

const GOOGLE_ADS_ID = "AW-18456978326";

export default async function HomePage() {
  const session = await auth();
  if (session?.user?.id) {
    if (session.user.isAdmin || (session.user as { role?: string }).role === "ADMIN") {
      redirect("/admin");
    }
    // RecruiterProfile is the current database-backed recruiter authority.
    // Checking it here keeps a stale JWT role from sending the wrong account
    // to its home surface.
    const recruiter = await getRecruiterState(session.user.id);
    redirect(recruiter.status === "none" ? "/dashboard" : "/hire");
  }

  const state = await getLandingState();
  return (
    <>
      <Script
        id="google-ads-gtag"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`}
      />
      <Script id="google-ads-config" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GOOGLE_ADS_ID}');
gtag('event', 'conversion', {'send_to': '${GOOGLE_ADS_ID}/NG4TCOnlroMdEJbH_OBE'});
function gtag_report_conversion(url) {
  var callback = function () {
    if (typeof(url) != 'undefined') {
      window.location = url;
    }
  };
  gtag('event', 'conversion', {
      'send_to': '${GOOGLE_ADS_ID}/NG4TCOnlroMdEJbH_OBE',
      'event_callback': callback
  });
  return false;
}`}
      </Script>
      <LandingPage
        claudeEnabled={isClaudeEnabled()}
        databricksEnabled={isDatabricksEnabled()}
        state={state}
      />
    </>
  );
}
