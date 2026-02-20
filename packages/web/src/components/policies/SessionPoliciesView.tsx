import { Layers, Plus, Shield, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import type { Policy, PolicySetSummary } from "@/types/api";

interface SessionPoliciesViewProps {
  sessionId: string;
}

export function SessionPoliciesView({ sessionId }: SessionPoliciesViewProps) {
  const [appliedSets, setAppliedSets] = useState<PolicySetSummary[]>([]);
  const [effectivePolicies, setEffectivePolicies] = useState<Policy[]>([]);
  const [allSets, setAllSets] = useState<PolicySetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSetId, setSelectedSetId] = useState<string>("");

  const loadData = useCallback(async () => {
    try {
      const [setsRes, effectiveRes, allSetsRes] = await Promise.all([
        api.getSessionPolicySets(sessionId),
        api.getEffectivePolicies(sessionId),
        api.getPolicySets(),
      ]);
      setAppliedSets(setsRes.policySets);
      setEffectivePolicies(effectiveRes.policies);
      setAllSets(allSetsRes.policySets);
    } catch {
      toast.error("Failed to load session policies");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleApplySet = async () => {
    if (!selectedSetId) return;
    try {
      await api.applyPolicySetToSession(sessionId, selectedSetId);
      toast.success("Policy set applied");
      setSelectedSetId("");
      loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to apply set");
    }
  };

  const handleRemoveSet = async (setId: string) => {
    try {
      await api.removePolicySetFromSession(sessionId, setId);
      toast.success("Policy set removed");
      loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove set");
    }
  };

  const availableSets = allSets.filter((s) => !appliedSets.some((a) => a.id === s.id));

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-16 justify-center">
        <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
        <span className="text-sm">Loading policies...</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Applied Policy Sets */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Layers className="h-4 w-4 text-cyan-400" />
            Applied Policy Sets
          </h3>
          {availableSets.length > 0 && (
            <div className="flex items-center gap-2">
              <Select value={selectedSetId} onValueChange={setSelectedSetId}>
                <SelectTrigger className="w-48 h-8 text-xs border-border bg-muted/30">
                  <SelectValue placeholder="Select a set..." />
                </SelectTrigger>
                <SelectContent>
                  {availableSets.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={handleApplySet}
                disabled={!selectedSetId}
                className="h-8 text-xs bg-cyan-600 hover:bg-cyan-700 text-white border-0"
              >
                <Plus className="h-3 w-3 mr-1" />
                Apply
              </Button>
            </div>
          )}
        </div>

        {appliedSets.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 text-center py-4 border border-dashed border-border rounded-lg">
            No policy sets applied to this session.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {appliedSets.map((set) => (
              <div
                key={set.id}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-muted/20 text-sm"
              >
                <Layers className="h-3 w-3 text-cyan-400" />
                <span>{set.name}</span>
                <span className="text-[10px] text-muted-foreground/50">({set.policyCount})</span>
                <button
                  type="button"
                  onClick={() => handleRemoveSet(set.id)}
                  className="ml-1 text-muted-foreground hover:text-red-400 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Effective Policies */}
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
          <Shield className="h-4 w-4 text-emerald-400" />
          Effective Policies
          <span className="text-xs font-normal text-muted-foreground">
            (resolved from direct + sets + global, sorted by priority)
          </span>
        </h3>

        {effectivePolicies.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 text-center py-4 border border-dashed border-border rounded-lg">
            No policies apply to this session.
          </p>
        ) : (
          <div className="space-y-2">
            {effectivePolicies.map((policy) => (
              <div
                key={policy.id}
                className="flex items-center justify-between py-2.5 px-4 rounded-lg border border-border bg-card/80"
              >
                <div className="flex items-center gap-3">
                  <Badge variant={policy.enabled ? "success" : "secondary"} className="text-[10px]">
                    {policy.enabled ? "Active" : "Off"}
                  </Badge>
                  <span className="text-sm font-medium">{policy.name}</span>
                  <span className="text-[10px] font-mono text-muted-foreground/50">
                    P:{policy.priority}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {policy.rules.map((rule) => (
                    <Badge
                      key={rule.id}
                      variant={
                        rule.action === "allow"
                          ? "success"
                          : rule.action === "deny"
                            ? "destructive"
                            : "warning"
                      }
                      className="text-[10px]"
                    >
                      {rule.action}
                      {rule.tool
                        ? `: ${Array.isArray(rule.tool) ? rule.tool.join(",") : rule.tool}`
                        : ""}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
