import { TrackPage } from "@/components/challenge/track-page";

export default async function AiTrackPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return <TrackPage domain="AI" searchParams={searchParams} />;
}
