import { TrackPage } from "@/components/challenge/track-page";

export default async function ClaudeTrackPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return <TrackPage domain="CLAUDE" searchParams={searchParams} />;
}
