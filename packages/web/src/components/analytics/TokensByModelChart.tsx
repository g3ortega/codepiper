import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/formatting";

interface ModelData {
  model: string;
  tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read: number;
  cache_creation: number;
  requests: number;
  costEstimate?: number;
}

interface TokensByModelChartProps {
  data: ModelData[];
}

const COLORS = ["#06b6d4", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#ec4899"];

function shortenModelName(model: string): string {
  return model
    .replace("claude-", "")
    .replace("-20250929", "")
    .replace("-20251001", "")
    .replace("-20260214", "");
}

export function TokensByModelChart({ data }: TokensByModelChartProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tokens by Model</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground/50">
            No model data yet
          </div>
        </CardContent>
      </Card>
    );
  }

  const pieData = data.map((d) => ({
    ...d,
    usedTokens: (d.prompt_tokens ?? 0) + (d.completion_tokens ?? 0),
  }));
  const total = pieData.reduce((sum, d) => sum + d.usedTokens, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tokens by Model</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6">
          <ResponsiveContainer width={180} height={180}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="usedTokens"
                nameKey="model"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                strokeWidth={2}
                stroke="hsl(var(--card))"
              >
                {pieData.map((entry, idx) => (
                  <Cell key={entry.model} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: "hsl(var(--foreground))",
                }}
                formatter={(value: number | undefined) => formatNumber(value ?? 0)}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-2.5">
            {pieData.map((item, idx) => {
              const used = item.usedTokens;
              const pct = total > 0 ? ((used / total) * 100).toFixed(1) : "0";
              return (
                <div key={item.model} className="flex items-center gap-2.5">
                  <div
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono truncate">{shortenModelName(item.model)}</div>
                    <div className="text-[10px] text-muted-foreground/60">
                      {formatNumber(used)} tokens ({pct}%)
                      {(item.cache_read ?? 0) > 0 && (
                        <span> &middot; {formatNumber(item.cache_read)} cached</span>
                      )}
                      <span> &middot; {item.requests} req</span>
                      {item.costEstimate != null && item.costEstimate > 0 && (
                        <span> &middot; ~${item.costEstimate.toFixed(2)}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
