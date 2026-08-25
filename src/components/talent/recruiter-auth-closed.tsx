const SUPPORT_EMAIL = "team@abtalks.in";

export function RecruiterAuthClosed({ compact = false }: { compact?: boolean }) {
  const body = (
    <p className="text-sm text-muted-foreground">
      Recruiter sign-in and registration aren&apos;t ready yet. Check back
      soon, or write to{" "}
      <a
        href={`mailto:${SUPPORT_EMAIL}`}
        className="font-medium text-primary hover:underline"
      >
        {SUPPORT_EMAIL}
      </a>
      .
    </p>
  );

  if (compact) return body;

  return (
    <div className="mx-auto max-w-md space-y-8 py-4">
      <header className="space-y-2 text-center">
        <p className="text-xs font-medium tracking-wide text-primary uppercase">
          ABTalks Hire
        </p>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Not open yet
        </h1>
        {body}
      </header>
    </div>
  );
}
