import { requireProgramMember } from "@/lib/program-auth";
import { getMemberDayStates } from "@/features/program/progression";
import { CurriculumMap } from "@/components/program/curriculum-map";

export default async function ProgramCurriculumPage() {
  const { member } = await requireProgramMember();
  const { modules, days } = await getMemberDayStates(member.id);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Curriculum
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your 31-day path. Pass each mission to unlock the next day.
        </p>
      </header>

      {modules.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          The curriculum is being prepared. Check back soon.
        </p>
      ) : (
        <CurriculumMap modules={modules} days={days} />
      )}
    </div>
  );
}
