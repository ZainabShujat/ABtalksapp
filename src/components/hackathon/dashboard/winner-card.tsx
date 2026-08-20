import type { WinnerPlace } from "@/components/hackathon/dashboard/vicodathon-winners";

export function WinnerCard({ place }: { place: WinnerPlace }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#A78BFA]">
        {place.placeLabel}
      </h2>
      <p className="mt-3 text-xl font-semibold tracking-tight text-white">
        {place.entryLabel}
      </p>
      <p className="mt-2 text-sm text-zinc-300">
        <span className="text-zinc-500">Problem statement · </span>
        {place.problemStatement}
      </p>

      <ul className="mt-4 space-y-3">
        {place.members.map((member) => {
          const meta = [
            member.college,
            member.graduationYear != null
              ? `Grad ${member.graduationYear}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ");

          return (
            <li
              key={`${place.place}-${member.fullName}`}
              className="rounded-xl border border-white/10 bg-black/40 px-3 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-white">
                  {member.fullName}
                </p>
                <span className="rounded-md border border-[#7364E6]/40 bg-[#7364E6]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#C4B5FD]">
                  {member.role}
                </span>
              </div>
              {meta ? (
                <p className="mt-1 text-xs text-zinc-400">{meta}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
