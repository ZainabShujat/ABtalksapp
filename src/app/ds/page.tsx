import { TrackPage } from "@/components/challenge/track-page";

export default async function DsTrackPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return <TrackPage domain="DS" searchParams={searchParams} />;
}
