"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CohortOverview } from "@/features/program/admin";

const PIE_COLORS = [
  "#E05226",
  "#10B981",
  "#0891B2",
  "#F97316",
  "#EC4899",
  "#EAB308",
  "#C9411C",
  "#14B8A6",
];

export function ProgramAnalyticsCharts({
  data,
}: {
  data: Omit<CohortOverview, "cohort">;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Score distribution</CardTitle>
        </CardHeader>
        <CardContent className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.scoreBuckets}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="bucket" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Module progress (avg %)</CardTitle>
        </CardHeader>
        <CardContent className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.moduleProgress}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="title" hide />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Bar dataKey="avgPct" fill="#10B981" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daily engagement</CardTitle>
        </CardHeader>
        <CardContent className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.dailyEngagement}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="missionRuns"
                stroke="hsl(var(--primary))"
                name="Mission runs"
              />
              <Line
                type="monotone"
                dataKey="commitDays"
                stroke="#10B981"
                name="Commit days"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Experience mix</CardTitle>
        </CardHeader>
        <CardContent className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data.experienceMix}
                dataKey="count"
                nameKey="band"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label
              >
                {data.experienceMix.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Mission funnel (pass rate %)</CardTitle>
        </CardHeader>
        <CardContent className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.missionFunnel}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="dayNumber" />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Bar dataKey="passRate" fill="#0891B2" name="Pass rate %" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {data.atRisk.length > 0 && (
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>At-risk members</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {data.atRisk.map((m) => (
                <li key={m.memberId} className="rounded-lg border px-3 py-2">
                  <span className="font-medium">{m.fullName}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {m.reasons.join(", ")}
                    {m.behindBy > 0 ? ` · ${m.behindBy} behind` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
