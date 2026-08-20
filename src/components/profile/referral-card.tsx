import { Users } from "lucide-react";
import { CopyCodeButton } from "@/components/profile/copy-code-button";

type Props = {
  referralCode: string;
  referralCount: number;
};

export function ReferralCard({ referralCode, referralCount }: Props) {
  return (
    <div className="rounded-2xl border bg-card p-6">
      <h3 className="mb-1 font-display text-lg font-semibold">
        Your Referral Code
      </h3>
      <p className="mb-4 text-sm text-muted-foreground">
        Share your code with friends. When they sign up using your code, it
        shows up here.
      </p>

      <div className="mb-4 flex items-center gap-3 rounded-lg border bg-muted/30 p-4">
        <code className="flex-1 font-mono text-lg font-bold tracking-wider">
          {referralCode}
        </code>
        <CopyCodeButton code={referralCode} />
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Users className="h-5 w-5 text-primary" aria-hidden />
        </div>
        <div>
          <div className="font-display text-xl font-bold">{referralCount}</div>
          <div className="text-xs text-muted-foreground">
            {referralCount === 1
              ? "person signed up"
              : "people signed up"}{" "}
            using your code
          </div>
        </div>
      </div>
    </div>
  );
}
