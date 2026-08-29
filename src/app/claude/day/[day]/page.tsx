import { ChallengeDayRoute } from "@/components/challenge/day-route";

type PageProps = {
  params: Promise<{ day: string }>;
  searchParams: Promise<{ challenge?: string | string[] }>;
};

export default async function ClaudeDayPage({ params, searchParams }: PageProps) {
  return (
    <ChallengeDayRoute
      dayPathPrefix="/claude/day"
      params={params}
      searchParams={searchParams}
    />
  );
}
