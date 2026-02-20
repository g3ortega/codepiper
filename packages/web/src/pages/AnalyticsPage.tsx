import { Activity, DollarSign, Download, MessageSquare, Server, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ActivityTimelineChart } from "@/components/analytics/ActivityTimelineChart";
import { SessionsByProviderChart } from "@/components/analytics/SessionsByProviderChart";
import { StatsCard } from "@/components/analytics/StatsCard";
import { TokensByModelChart } from "@/components/analytics/TokensByModelChart";
import { TokenUsageChart } from "@/components/analytics/TokenUsageChart";
import { ToolUsageChart } from "@/components/analytics/ToolUsageChart";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatNumber } from "@/lib/formatting";
import type { ProviderInfo } from "@/types/api";

interface OverviewData {
  sessionsCount: number;
  activeSessions: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalMessages: number;
  cacheHitRate: number;
  costEstimate: number;
}

export function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState("7d");
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [activityTimeline, setActivityTimeline] = useState<any[]>([]);
  const [tokensByModel, setTokensByModel] = useState<any[]>([]);
  const [tokenUsage, setTokenUsage] = useState<any[]>([]);
  const [toolUsage, setToolUsage] = useState<any[]>([]);
  const [sessionsByProvider, setSessionsByProvider] = useState<any[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewRes, activityRes, modelRes, tokenRes, toolRes, providerRes, providersRes] =
        await Promise.all([
          fetch(`/api/analytics/overview?range=${timeRange}`),
          fetch(`/api/analytics/activity-timeline?range=${timeRange}`),
          fetch(`/api/analytics/tokens-by-model?range=${timeRange}`),
          fetch(`/api/analytics/token-usage?range=${timeRange}`),
          fetch(`/api/analytics/tool-usage?range=${timeRange}`),
          fetch(`/api/analytics/sessions-by-provider?range=${timeRange}`),
          fetch("/api/providers"),
        ]);

      if (!overviewRes.ok) throw new Error("Failed to load overview");

      const [
        overviewData,
        activityData,
        modelData,
        tokenData,
        toolData,
        providerData,
        providersData,
      ] = await Promise.all([
        overviewRes.json(),
        activityRes.json(),
        modelRes.json(),
        tokenRes.json(),
        toolRes.json(),
        providerRes.json(),
        providersRes.ok ? providersRes.json() : Promise.resolve({ providers: [] }),
      ]);

      setOverview(overviewData);
      setActivityTimeline(activityData);
      setTokensByModel(modelData);
      setTokenUsage(tokenData);
      setToolUsage(toolData);
      setSessionsByProvider(providerData);
      setProviders(Array.isArray(providersData.providers) ? providersData.providers : []);
    } catch (error) {
      console.error("Error loading analytics:", error);
      toast.error("Failed to load analytics data");
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const exportCSV = () => {
    const headers = ["Date", "Prompt Tokens", "Completion Tokens", "Cache Read", "Cache Creation"];
    const rows = tokenUsage.map((row: any) => [
      row.date,
      row.prompt,
      row.completion,
      row.cacheRead,
      row.cacheCreation,
    ]);
    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-${timeRange}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported successfully");
  };

  if (loading || !overview) {
    return (
      <div className="p-4 md:p-8 max-w-7xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Analytics</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Token usage, activity patterns, and session metrics
            </p>
          </div>
        </div>
        <div className="flex h-64 items-center justify-center">
          <div className="flex items-center gap-3 text-muted-foreground">
            <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
            <span className="text-sm">Loading analytics...</span>
          </div>
        </div>
      </div>
    );
  }

  const providerById = new Map<string, ProviderInfo>(
    providers.map((provider) => [provider.id, provider])
  );
  const limitedMetricsProviders = sessionsByProvider
    .filter((row: any) => Number(row.count) > 0)
    .map((row: any) => providerById.get(String(row.provider)))
    .filter(
      (provider: ProviderInfo | undefined): provider is ProviderInfo =>
        !!provider && provider.capabilities.metricsChannel !== "transcript"
    );
  const hasLimitedMetricsProviders = limitedMetricsProviders.length > 0;
  const limitedMetricsProviderLabels = Array.from(
    new Set(limitedMetricsProviders.map((provider) => provider.label))
  );

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Token usage, activity patterns, and session metrics
          </p>
        </div>
        <div className="flex gap-3">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-36 border-border bg-muted/30">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={exportCSV}
            className="border-border hover:bg-accent/60"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatsCard
          title="Total Sessions"
          value={overview.sessionsCount}
          subtitle={`${overview.activeSessions} active`}
          icon={<Server className="h-4 w-4 text-cyan-400" />}
        />
        <StatsCard
          title="Total Messages"
          value={formatNumber(overview.totalMessages)}
          subtitle="User + assistant turns"
          icon={<MessageSquare className="h-4 w-4 text-emerald-400" />}
        />
        <StatsCard
          title="Tokens Used"
          value={formatNumber(
            overview.inputTokens != null
              ? overview.inputTokens + overview.outputTokens
              : overview.totalTokens
          )}
          subtitle={
            (overview.cacheReadTokens ?? 0) > 0
              ? `${formatNumber(overview.cacheReadTokens)} cached`
              : undefined
          }
          icon={<Activity className="h-4 w-4 text-violet-400" />}
        />
        <StatsCard
          title="Cache Hit Rate"
          value={`${overview.cacheHitRate}%`}
          subtitle={
            overview.cacheHitRate >= 50 ? "Excellent" : overview.cacheHitRate >= 20 ? "Good" : "Low"
          }
          icon={<Zap className="h-4 w-4 text-amber-400" />}
        />
        <StatsCard
          title="Est. API Cost"
          value={`$${overview.costEstimate.toFixed(2)}`}
          subtitle="Equivalent if billed per-token"
          icon={<DollarSign className="h-4 w-4 text-emerald-400" />}
        />
      </div>

      {/* Cost disclaimer */}
      {overview.costEstimate > 0 && (
        <div className="mb-6 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
          <p className="text-xs text-muted-foreground/70">
            <span className="font-medium text-muted-foreground">Cost estimate disclaimer:</span>{" "}
            This is an approximate equivalent API cost based on published Anthropic pricing. Actual
            costs may differ due to long-context pricing (&gt;200K tokens), internal requests not
            captured in transcripts (e.g. context summarization), and pricing changes. Max plan
            subscribers are not charged per-token.
          </p>
        </div>
      )}

      {hasLimitedMetricsProviders && (
        <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
          <p className="text-xs text-muted-foreground/80">
            <span className="font-medium text-amber-300">Provider metrics note:</span> Token and
            tool analytics are transcript-driven. Active sessions from{" "}
            {limitedMetricsProviderLabels.join(", ")} may not fully appear in token charts.
          </p>
        </div>
      )}

      {/* Charts Grid */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <ActivityTimelineChart data={activityTimeline} />
        </div>

        <TokensByModelChart data={tokensByModel} />
        <ToolUsageChart data={toolUsage} />

        <div className="lg:col-span-2">
          <TokenUsageChart data={tokenUsage} />
        </div>

        <SessionsByProviderChart data={sessionsByProvider} />
      </div>
    </div>
  );
}
