import Link from "next/link";
import { Award } from "lucide-react";
import type { AchievementView } from "@/features/certificate/get-achievements";
import { CopyVerifyLinkButton } from "@/components/certificate/copy-verify-link-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Props = {
  achievement: AchievementView;
  verifyBaseUrl: string;
};

export function AchievementCard({ achievement, verifyBaseUrl }: Props) {
  const isRevoked = achievement.status === "REVOKED";

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3 sm:pb-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Award className="size-5 text-primary" aria-hidden />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base sm:text-lg">
                {achievement.title}
              </CardTitle>
              {isRevoked ? (
                <Badge variant="destructive">Revoked</Badge>
              ) : (
                <Badge className="bg-green-600 text-white hover:bg-green-600/90">
                  {achievement.statusLabel}
                </Badge>
              )}
            </div>
            <CardDescription>{achievement.subtitle}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Certificate ID</dt>
            <dd className="font-mono font-medium">
              {achievement.certificateId}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Issued on</dt>
            <dd className="font-medium">{achievement.issuedOn}</dd>
          </div>
          {achievement.stats.map((stat) => (
            <div key={stat.label}>
              <dt className="text-muted-foreground">{stat.label}</dt>
              <dd className="font-medium">{stat.value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/verify/${achievement.certificateId}`}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            View certificate
          </Link>
          {!isRevoked ? (
            <>
              <a
                href={`/verify/${achievement.certificateId}/download`}
                className={cn(buttonVariants())}
                download
              >
                Download PDF
              </a>
              <CopyVerifyLinkButton
                link={`${verifyBaseUrl}/verify/${achievement.certificateId}`}
              />
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
