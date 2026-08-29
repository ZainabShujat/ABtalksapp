import { ChallengeDayRoute } from "@/components/challenge/day-route";

type PageProps = {
  params: Promise<{ day: string }>;
  searchParams: Promise<{ challenge?: string | string[] }>;
};

export default async function ChallengeDayPage({
  params,
  searchParams,
}: PageProps) {
  return (
    <ChallengeDayRoute
      dayPathPrefix="/challenge"
      params={params}
      searchParams={searchParams}
    />
  );
}
