import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/formatting";

interface TokenData {
  date: string;
  prompt: number;
  completion: number;
  cacheCreation: number;
  cacheRead: number;
}

interface TokenUsageChartProps {
  data: TokenData[];
}

const COLORS = {
  prompt: "#06b6d4",
  completion: "#8b5cf6",
  cacheCreation: "#f59e0b",
  cacheRead: "#10b981",
};

export function TokenUsageChart({ data }: TokenUsageChartProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Token Usage Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground/50">
            No token data yet
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Token Usage Over Time</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="promptGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS.prompt} stopOpacity={0.3} />
                <stop offset="95%" stopColor={COLORS.prompt} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="completionGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS.completion} stopOpacity={0.3} />
                <stop offset="95%" stopColor={COLORS.completion} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="cacheCreateGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS.cacheCreation} stopOpacity={0.3} />
                <stop offset="95%" stopColor={COLORS.cacheCreation} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="cacheReadGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS.cacheRead} stopOpacity={0.3} />
                <stop offset="95%" stopColor={COLORS.cacheRead} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} />
            <XAxis
              dataKey="date"
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => {
                const d = new Date(v);
                return `${d.getMonth() + 1}/${d.getDate()}`;
              }}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              tickFormatter={(v) => formatNumber(v)}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                fontSize: "12px",
                color: "hsl(var(--foreground))",
              }}
              formatter={(value: number | undefined) => formatNumber(value ?? 0)}
              labelFormatter={(v) => `Date: ${v}`}
            />
            <Area
              type="monotone"
              dataKey="prompt"
              stackId="1"
              stroke={COLORS.prompt}
              strokeWidth={2}
              fill="url(#promptGrad)"
              name="Prompt"
            />
            <Area
              type="monotone"
              dataKey="completion"
              stackId="1"
              stroke={COLORS.completion}
              strokeWidth={2}
              fill="url(#completionGrad)"
              name="Completion"
            />
            <Area
              type="monotone"
              dataKey="cacheCreation"
              stackId="1"
              stroke={COLORS.cacheCreation}
              strokeWidth={2}
              fill="url(#cacheCreateGrad)"
              name="Cache Creation"
            />
            <Area
              type="monotone"
              dataKey="cacheRead"
              stackId="1"
              stroke={COLORS.cacheRead}
              strokeWidth={2}
              fill="url(#cacheReadGrad)"
              name="Cache Read"
            />
          </AreaChart>
        </ResponsiveContainer>
        <div className="mt-3 flex justify-center gap-5 text-xs">
          {Object.entries(COLORS).map(([key, color]) => (
            <div key={key} className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-muted-foreground capitalize">
                {key.replace(/([A-Z])/g, " $1").trim()}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
