import { notFound } from "next/navigation";
import { isProgramEnabled } from "@/lib/feature-flags";

export default function ProgramLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isProgramEnabled()) notFound();
  return <>{children}</>;
}
 
