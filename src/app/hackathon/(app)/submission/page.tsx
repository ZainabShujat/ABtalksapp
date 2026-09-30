import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Submit, redirecting…",
};

/**
 * VideoThon uses a single dashboard surface that embeds the submission form,
 * so this URL just forwards. Kept as its own route (rather than deleted) so
 * bookmarks and email links to `/hackathon/submission` from the old code
 * hackathon still land in the right place.
 */
export default function VideothonSubmissionPage(): never {
  redirect("/hackathon/dashboard");
}
