import { Skeleton } from "@/components/ui/skeleton";

const NAV_ITEMS = Array.from({ length: 6 });
const HEATMAP_ROWS = Array.from({ length: 7 });
const HEATMAP_COLUMNS = Array.from({ length: 12 });

export default function DashboardLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading dashboard"
      className="theme-abtalks-light theme-abtalks-orange flex min-h-svh bg-[#FBF9F7] font-content text-[#111111]"
    >
      <aside className="hidden w-64 shrink-0 flex-col border-r border-[#E0E0E0] bg-[#FBF9F7] md:flex">
        <div className="flex h-[72px] items-center border-b border-[#E0E0E0] px-4">
          <Skeleton className="h-8 w-28 bg-[#E0E0E0]" />
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4" aria-hidden>
          {NAV_ITEMS.map((_, index) => (
            <div key={index} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton className="size-5 rounded-md bg-[#E0E0E0]" />
              <Skeleton className="h-4 w-24 bg-[#E0E0E0]" />
            </div>
          ))}
        </nav>
        <div className="border-t border-[#E0E0E0] p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-full bg-[#E0E0E0]" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-28 bg-[#E0E0E0]" />
              <Skeleton className="h-3 w-36 bg-[#E0E0E0]" />
            </div>
          </div>
          <Skeleton className="mt-5 h-9 w-full bg-[#E0E0E0]" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[72px] items-center justify-between border-b border-[#E0E0E0] bg-[#FBF9F7] px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-md bg-[#E0E0E0] md:hidden" />
            <Skeleton className="h-4 w-24 bg-[#E0E0E0]" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-md bg-[#E0E0E0]" />
            <Skeleton className="hidden h-9 w-24 bg-[#E0E0E0] sm:block" />
            <Skeleton className="size-9 rounded-full bg-[#E0E0E0]" />
          </div>
        </header>

        <main className="flex-1 px-4 py-8 sm:px-6">
          <div className="w-full max-w-[1020px] space-y-8 lg:ml-5 2xl:mx-auto 2xl:max-w-[1600px]">
            <section className="space-y-3">
              <Skeleton className="h-4 w-28 bg-[#E0E0E0]" />
              <Skeleton className="h-10 w-72 max-w-full bg-[#E0E0E0]" />
              <Skeleton className="h-5 w-full max-w-xl bg-[#E0E0E0]" />
            </section>

            <div className="grid min-w-0 gap-6 lg:grid-cols-[1fr_320px] lg:items-center lg:gap-8">
              <section className="rounded-[12px] border border-[#E0E0E0] bg-white p-5 shadow-[0_2px_8px_rgba(0,0,0,0.06)] lg:pr-6">
                <div className="mb-5 flex items-center justify-between gap-4">
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-36 bg-[#E0E0E0]" />
                    <Skeleton className="h-3 w-52 bg-[#E0E0E0]" />
                  </div>
                  <Skeleton className="h-8 w-20 bg-[#E0E0E0]" />
                </div>
                <div className="grid grid-cols-12 gap-1.5" aria-hidden>
                  {HEATMAP_ROWS.flatMap((_, row) =>
                    HEATMAP_COLUMNS.map((_, column) => (
                      <Skeleton
                        key={`${row}-${column}`}
                        className="aspect-square rounded-[4px] bg-[#E0E0E0]"
                      />
                    )),
                  )}
                </div>
              </section>

              <section className="rounded-[12px] border border-[#E0E0E0] bg-white p-5 shadow-[0_2px_8px_rgba(0,0,0,0.06)] lg:pl-5">
                <Skeleton className="h-4 w-24 bg-[#E0E0E0]" />
                <Skeleton className="mt-4 h-24 w-24 rounded-full bg-[#E0E0E0]" />
                <Skeleton className="mt-5 h-5 w-40 bg-[#E0E0E0]" />
                <Skeleton className="mt-2 h-4 w-full bg-[#E0E0E0]" />
              </section>
            </div>

            <section className="grid gap-6 lg:grid-cols-2">
              {Array.from({ length: 2 }).map((_, index) => (
                <div
                  key={index}
                  className="rounded-[12px] border border-[#E0E0E0] bg-white p-5 shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                >
                  <Skeleton className="h-5 w-40 bg-[#E0E0E0]" />
                  <Skeleton className="mt-3 h-4 w-full bg-[#E0E0E0]" />
                  <Skeleton className="mt-2 h-4 w-4/5 bg-[#E0E0E0]" />
                  <Skeleton className="mt-5 h-10 w-36 bg-[#E0E0E0]" />
                </div>
              ))}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
