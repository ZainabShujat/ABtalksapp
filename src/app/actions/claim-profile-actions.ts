"use server";

import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { acknowledgeClaimProfile } from "@/features/resume/import/claim";

export type ClaimProfileActionResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; message: string };

export async function acknowledgeClaimProfileAction(
  nextPath: string = "/profile",
): Promise<ClaimProfileActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Not authenticated" };
  }

  try {
    await acknowledgeClaimProfile(session.user.id);
    const cookieStore = await cookies();
    cookieStore.set("abtalks_claim_ack", "1", {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      httpOnly: true,
      sameSite: "lax",
    });

    revalidatePath("/dashboard");
    revalidatePath("/profile");
    return { ok: true, redirectUrl: nextPath };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to record claim acknowledgement",
    };
  }
}
