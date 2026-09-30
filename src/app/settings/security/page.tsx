import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  hasUsablePassword,
  isFreshSignIn,
  isGoogleOnlyAccount,
} from "@/lib/email-auth";
import { isEmailLoginEnabled } from "@/lib/feature-flags";
import { PasswordSettingsForm } from "@/components/settings/password-settings-form";

export const metadata: Metadata = {
  title: "Password & sign-in | ABTalks",
};

/**
 * Plan 154. Set a first password, or change the current one. Any signed-in
 * account — candidate or recruiter; the form signs them back in through their
 * own door after a change.
 */
export default async function SecuritySettingsPage() {
  if (!isEmailLoginEnabled()) notFound();

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?from=/settings/security");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      role: true,
      password: true,
      recruiterProfile: { select: { id: true } },
    },
  });
  if (!user) redirect("/login?from=/settings/security");

  const googleOnly = await isGoogleOnlyAccount(user.email, user);

  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <h1 className="mb-2 text-2xl font-semibold">Password &amp; sign-in</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Signed in as <span className="font-medium text-foreground">{user.email}</span>.
        You can always sign in with an emailed code; a password is an extra way
        in.
      </p>
      <PasswordSettingsForm
        email={user.email}
        audience={user.recruiterProfile ? "recruiter" : "candidate"}
        hasPassword={hasUsablePassword(user)}
        googleOnly={googleOnly}
        needsCode={!isFreshSignIn(session.authTime)}
      />
    </main>
  );
}
