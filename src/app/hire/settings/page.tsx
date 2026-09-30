import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { isEmailLoginEnabled } from "@/lib/feature-flags";
import { requireRecruiter } from "@/lib/program-auth";
import { requireRecruiterWorkspace } from "@/features/recruiter-workspace/workspace";
import { blockingPurchasedBalanceMinor } from "@/features/hire/delete-recruiter-account";
import { cn } from "@/lib/utils";
import { isCompanyLogoStorageConfigured } from "@/features/hire/org-logo-storage";
import { getRecruiterProfileAction } from "@/app/actions/recruiter-profile-actions";
import { RecruiterProfileForm } from "@/components/hire/recruiter-profile-form";
import { DeleteRecruiterAccountDialog } from "@/components/hire/delete-recruiter-account-dialog";

export const metadata: Metadata = {
  title: "Settings | ABTalks Hire",
};

/**
 * Recruiter settings page (T-227).
 * Allows the recruiter to view and edit their profile (name, phone) and
 * company identity (name, website, industry, size, location).
 * Isolated per-recruiter workspace via requireRecruiter().
 */
export default async function HireSettingsPage() {
  await requireRecruiter();
  const res = await getRecruiterProfileAction();
  const workspace = await requireRecruiterWorkspace();
  const purchasedBalanceMinor = workspace.ok
    ? await blockingPurchasedBalanceMinor(workspace.data.organizationId)
    : 0;

  if (!res.ok) {
    return (
      <div className="hire-settings space-y-6 pb-12">
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-wider text-primary uppercase">
            Workspace
          </p>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">
            Settings
          </h1>
          <p className="max-w-2xl text-sm text-destructive">
            {res.message}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="hire-settings space-y-6 pb-12">
      <div className="space-y-2">
        <p className="text-xs font-semibold tracking-wider text-primary uppercase">
          Workspace
        </p>
        <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">
          Settings
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Manage your personal recruiter profile and company identity. Changes
          reflect on your outreach messages, candidate searches, and job posts.
        </p>
      </div>

      <RecruiterProfileForm
        initialData={res.data}
        logoUploadAvailable={isCompanyLogoStorageConfigured()}
      />

      {isEmailLoginEnabled() ? (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-heading text-base font-semibold text-foreground">
            Password &amp; sign-in
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in with an emailed code, or set a password to use instead.
          </p>
          <Link
            href="/settings/security"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}
          >
            Manage password
          </Link>
        </section>
      ) : null}

      <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
        <h2 className="font-heading text-base font-semibold text-foreground">
          Danger zone
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Deleting your account removes your projects, searches, shortlists,
          outreach and assessments, and cannot be undone.
        </p>
        <div className="mt-3">
          <DeleteRecruiterAccountDialog
            purchasedBalanceMinor={purchasedBalanceMinor}
          />
        </div>
      </section>
    </div>
  );
}
