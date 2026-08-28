import { TrackPage } from "@/components/challenge/track-page";

export default async function SeTrackPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return <TrackPage domain="SE" searchParams={searchParams} />;
}
