import "server-only";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export type DemandBoardRow = {
  stackToken: string;
  requestCount: number;
  activeCount: number;
  medianSalary: number | null;
  seniorities: string[];
};

export type DemandBoardData = {
  rows: DemandBoardRow[];
  totalRequests: number;
  activeRequests: number;
  matchedRequests: number;
};

export async function getDemandBoard(): Promise<
  { ok: true; data: DemandBoardData } | { ok: false; message: string }
> {
  try {
    const requests = await prisma.talentRequest.findMany({
      where: { status: { in: ["ACTIVE", "MATCHED", "FULFILLED", "DRAFT"] } },
      select: {
        status: true,
        mustHaveStack: true,
        salaryMin: true,
        salaryMax: true,
        seniority: true,
      },
      take: 500,
      orderBy: { createdAt: "desc" },
    });

    const byToken = new Map<
      string,
      {
        requestCount: number;
        activeCount: number;
        salaries: number[];
        seniorities: Set<string>;
      }
    >();

    for (const r of requests) {
      const tokens =
        r.mustHaveStack.length > 0 ? r.mustHaveStack : ["(unspecified)"];
      for (const raw of tokens) {
        const token = raw.trim() || "(unspecified)";
        const key = token.toLowerCase();
        let row = byToken.get(key);
        if (!row) {
          row = {
            requestCount: 0,
            activeCount: 0,
            salaries: [],
            seniorities: new Set(),
          };
          byToken.set(key, row);
        }
        row.requestCount += 1;
        if (r.status === "ACTIVE" || r.status === "DRAFT") row.activeCount += 1;
        const mid =
          r.salaryMin != null && r.salaryMax != null
            ? Math.round((r.salaryMin + r.salaryMax) / 2)
            : (r.salaryMax ?? r.salaryMin ?? null);
        if (mid != null) row.salaries.push(mid);
        if (r.seniority) row.seniorities.add(r.seniority);
      }
    }

    const rows: DemandBoardRow[] = [...byToken.entries()]
      .map(([_, v]) => {
        const sorted = [...v.salaries].sort((a, b) => a - b);
        const medianSalary =
          sorted.length === 0
            ? null
            : sorted[Math.floor(sorted.length / 2)] ?? null;
        // recover display token from first request-ish: use map key capitalization weak
        return {
          stackToken: _,
          requestCount: v.requestCount,
          activeCount: v.activeCount,
          medianSalary,
          seniorities: [...v.seniorities],
        };
      })
      .sort((a, b) => b.requestCount - a.requestCount)
      .slice(0, 40)
      // pretty token
      .map((r) => ({
        ...r,
        stackToken: r.stackToken === "(unspecified)" ? "(unspecified)" : r.stackToken,
      }));

    // Fix display: store original casing better
    const display = new Map<string, string>();
    for (const r of requests) {
      for (const t of r.mustHaveStack) {
        const k = t.trim().toLowerCase();
        if (k && !display.has(k)) display.set(k, t.trim());
      }
    }
    for (const row of rows) {
      if (row.stackToken !== "(unspecified)") {
        row.stackToken = display.get(row.stackToken) ?? row.stackToken;
      }
    }

    return {
      ok: true,
      data: {
        rows,
        totalRequests: requests.length,
        activeRequests: requests.filter((r) =>
          ["ACTIVE", "DRAFT"].includes(r.status),
        ).length,
        matchedRequests: requests.filter((r) => r.status === "MATCHED").length,
      },
    };
  } catch (error) {
    logger.error("[hire] getDemandBoard failed", { error: String(error) });
    return {
      ok: false,
      message: "Could not load demand board (migration applied?).",
    };
  }
}
