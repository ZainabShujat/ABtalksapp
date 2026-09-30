import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Plan 154: shown on the dashboard to a student whose account an admin created
 * from an imported résumé, once they have signed in with Google and claimed it.
 * They never saw the registration form, so they are asked to check the profile
 * and verify their phone; it stays until the phone is verified on /profile.
 * Server Component, no props.
 */
export function ProfileReviewBanner() {
  return (
    <section className="px-4 py-2 sm:px-6 lg:ml-4">
      <div
        role="status"
        className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
          <div>
            <p className="font-semibold">Check your profile and verify your phone number</p>
            <p className="mt-0.5 text-amber-900">
              We filled in your profile from your résumé. Please check that your details are
              correct and verify your phone number — recruiters see this profile.
            </p>
          </div>
        </div>
        <Link
          href="/profile"
          className={cn(buttonVariants({ size: "sm" }), "shrink-0 w-full sm:w-auto justify-center text-center self-stretch sm:self-center")}
        >
          Review my profile
        </Link>
      </div>
    </section>
  );
}
