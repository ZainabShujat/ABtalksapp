"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ChartDatum {
  name: string;
  New: number;
  Returning: number;
}

/**
 * New vs returning per workshop, stacked so the bar height is the workshop's
 * total. Client component — Recharts needs the browser.
 */
export function WorkshopAnalyticsChart({ data }: { data: ChartDatum[] }) {
  if (data.length === 0) return null;

  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="mb-4 text-sm font-medium">Registrations per workshop</p>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11 }}
              interval={0}
              tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)}
            />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="New" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Returning" stackId="a" fill="#e05226" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
