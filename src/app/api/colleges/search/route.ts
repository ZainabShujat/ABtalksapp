/**
 * College typeahead search. This is a GET Route Handler rather than a Server
 * Action because it is a read on a hot typing path: Server Action calls are
 * serialized by the Next.js client router, while GET allows real parallelism
 * plus Cache-Control reuse across users typing the same prefix.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { searchColleges } from "@/features/college/search-colleges";

const querySchema = z.string().max(100).trim();

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false as const, message: "Not authenticated" },
      { status: 401 },
    );
  }

  const q = new URL(request.url).searchParams.get("q") ?? "";
  const parsed = querySchema.safeParse(q);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid query" },
      { status: 400 },
    );
  }

  const data = await searchColleges(parsed.data);
  return NextResponse.json(
    { ok: true as const, data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
