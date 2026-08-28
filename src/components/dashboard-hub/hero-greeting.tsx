import { formatInTimeZone } from "date-fns-tz";
import { IST } from "@/lib/date-utils";

type HeroGreetingProps = {
  firstName: string | null;
};

function getGreeting(): string {
  const hour = parseInt(formatInTimeZone(new Date(), IST, "H"), 10);
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

export function HeroGreeting({ firstName }: HeroGreetingProps) {
  const greeting = getGreeting();

  return (
    <div>
      <h1 className="font-inter text-3xl font-bold tracking-tight text-[#111111] sm:text-4xl">
        {firstName ? `${greeting}, ${firstName}` : "Welcome"}
      </h1>
      <p className="mt-2 text-[#555555]">
        {firstName
          ? "Pick up where you left off or explore something new."
          : "Sign in to your hub to browse challenges, events, and resources."}
      </p>
    </div>
  );
}
