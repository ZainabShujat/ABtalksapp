import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, Phone, ExternalLink, Calendar } from "lucide-react";
import { formatDateIST } from "@/lib/date-utils";

export default async function CampusAmbassadorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const search = sp.q?.trim() ?? "";

  const candidates = await prisma.studentProfile.findMany({
    where: {
      isCampusAmbassadorCandidate: true,
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: "insensitive" } },
              { college: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { ambassadorAppliedAt: "desc" },
    select: {
      userId: true,
      fullName: true,
      phone: true,
      college: true,
      graduationYear: true,
      linkedinUrl: true,
      domain: true,
      ambassadorAppliedAt: true,
      user: {
        select: {
          email: true,
        },
      },
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold md:text-3xl">
            Campus Ambassador Candidates
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {candidates.length} student{candidates.length !== 1 ? "s" : ""}{" "}
            interested in being a campus ambassador. New ambassadors enroll at{" "}
            <a
              href="https://abtalksca.netlify.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              abtalksca.netlify.app
            </a>
            ; this list is students who opted in from the dashboard.
          </p>
        </div>

        <form className="flex w-full gap-2 md:w-auto md:min-w-[320px]" method="get">
          <Input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Search Campus Ambassadors"
            className="md:w-[240px]"
          />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      </div>

      {candidates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              No candidates yet. Students who opt in to be campus ambassadors
              will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {candidates.map((candidate) => (
            <Card key={candidate.userId}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-lg truncate">
                      {candidate.fullName ?? "Unnamed"}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {candidate.college ?? "No college"}
                      {candidate.graduationYear &&
                        ` • Class of ${candidate.graduationYear}`}
                    </CardDescription>
                  </div>
                  <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 px-2 py-0.5 text-xs font-medium">
                    {candidate.domain}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <a
                  href={`mailto:${candidate.user.email}`}
                  className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
                >
                  <Mail className="h-4 w-4 shrink-0" />
                  <span className="truncate">{candidate.user.email}</span>
                </a>

                {candidate.phone && (
                  <a
                    href={`tel:${candidate.phone}`}
                    className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
                  >
                    <Phone className="h-4 w-4 shrink-0" />
                    <span>{candidate.phone}</span>
                  </a>
                )}

                {candidate.linkedinUrl && (
                  <a
                    href={candidate.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-4 w-4 shrink-0" />
                    <span>LinkedIn profile</span>
                  </a>
                )}

                {candidate.ambassadorAppliedAt && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                    <Calendar className="h-3 w-3" />
                    <span>
                      Applied {formatDateIST(candidate.ambassadorAppliedAt)}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
