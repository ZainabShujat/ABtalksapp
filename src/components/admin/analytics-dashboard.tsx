"use client";

import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TimeRange } from "@/features/admin/get-analytics-data";

const domainColors: Record<string, string> = {
  SE: "#10B981",
  DS: "#0891B2",
  AI: "#E05226",
  CLAUDE: "#F97316",
  Hackathon: "#EF4444",
};

type AnalyticsData = {
  range: TimeRange;
  registrationsSeries: Array<{ label: string; count: number }>;
  submissionsSeries: Array<{ label: string; count: number }>;
  domainDistribution: Array<{ name: string; value: number }>;
  dropOff: Array<{ milestone: string; count: number }>;
  submissionsByHour: Array<{ hour: string; count: number }>;
  topPerformers: Array<{
    name: string;
    domain: string;
    daysCompleted: number;
    currentStreak: number;
  }>;
};

function registrationsTitle(range: TimeRange) {
  if (range === "weekly") return "Registrations: Last 12 Weeks";
  if (range === "monthly") return "Registrations: Last 12 Months";
  return "Registrations: Last 30 Days";
}

function submissionsTitle(range: TimeRange) {
  if (range === "weekly") return "Submissions: Last 12 Weeks";
  if (range === "monthly") return "Submissions: Last 12 Months";
  return "Submissions: Last 30 Days";
}

export function AnalyticsDashboard({ data }: { data: AnalyticsData }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{registrationsTitle(data.range)}</CardTitle>
        </CardHeader>
        <CardContent className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.registrationsSeries}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" minTickGap={24} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="count"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{submissionsTitle(data.range)}</CardTitle>
        </CardHeader>
        <CardContent className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.submissionsSeries}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" minTickGap={24} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="count"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Domain Distribution</CardTitle>
        </CardHeader>
        <CardContent className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data.domainDistribution}
                dataKey="value"
                nameKey="name"
                outerRadius={90}
                label
              >
                {data.domainDistribution.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={domainColors[entry.name] ?? "hsl(var(--primary))"}
                  />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Drop-off by Milestone</CardTitle>
        </CardHeader>
        <CardContent className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.dropOff}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="milestone" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Submissions by Hour (IST)</CardTitle>
        </CardHeader>
        <CardContent className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.submissionsByHour}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" minTickGap={16} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Top Performers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Days Completed</TableHead>
                <TableHead>Current Streak</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.topPerformers.map((row) => (
                <TableRow key={`${row.name}-${row.domain}`}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.domain}</TableCell>
                  <TableCell>{row.daysCompleted}</TableCell>
                  <TableCell>{row.currentStreak}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
