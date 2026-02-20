import { ChevronDown, ChevronRight, Layers, Star, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { Policy, PolicySetSummary } from "@/types/api";

interface PolicySetCardProps {
  policySet: PolicySetSummary;
  allPolicies: Policy[];
  onUpdated: () => void;
}

export function PolicySetCard({ policySet, allPolicies, onUpdated }: PolicySetCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [members, setMembers] = useState<Policy[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const load = async () => {
      setLoadingMembers(true);
      try {
        const res = await api.getPolicySet(policySet.id);
        setMembers(res.policySet.policies);
      } catch {
        toast.error("Failed to load policy set members");
      } finally {
        setLoadingMembers(false);
      }
    };
    load();
  }, [expanded, policySet.id]);

  const handleDelete = async () => {
    if (!confirm(`Delete policy set "${policySet.name}"?`)) return;
    try {
      setDeleting(true);
      await api.deletePolicySet(policySet.id);
      toast.success("Policy set deleted");
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleDefault = async () => {
    try {
      await api.updatePolicySet(policySet.id, { isDefault: !policySet.isDefault });
      toast.success(policySet.isDefault ? "Removed as default" : "Set as default");
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    }
  };

  const handleRemoveMember = async (policyId: string) => {
    try {
      await api.removePolicyFromSet(policySet.id, policyId);
      setMembers((m) => m.filter((p) => p.id !== policyId));
      toast.success("Policy removed from set");
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
    }
  };

  const handleAddMember = async (policyId: string) => {
    try {
      await api.addPolicyToSet(policySet.id, policyId);
      const policy = allPolicies.find((p) => p.id === policyId);
      if (policy) setMembers((m) => [...m, policy]);
      toast.success("Policy added to set");
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add");
    }
  };

  const availablePolicies = allPolicies.filter((p) => !members.some((m) => m.id === p.id));

  return (
    <div className="rounded-xl border border-border bg-card/80 backdrop-blur-sm overflow-hidden">
      <button
        type="button"
        className="flex items-center justify-between w-full p-5 cursor-pointer hover:bg-accent/30 transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <Layers className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold">{policySet.name}</h3>
          {policySet.isDefault && (
            <Badge variant="warning" className="text-[10px]">
              <Star className="h-2.5 w-2.5 mr-1" />
              Default
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {policySet.policyCount} {policySet.policyCount === 1 ? "policy" : "policies"}
          </span>
          <span className="text-xs text-muted-foreground/50">
            {policySet.sessionCount} {policySet.sessionCount === 1 ? "session" : "sessions"}
          </span>
        </div>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: stop propagation wrapper */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: stop propagation wrapper */}
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-amber-400"
            onClick={handleToggleDefault}
          >
            <Star className={`h-3 w-3 mr-1 ${policySet.isDefault ? "fill-amber-400" : ""}`} />
            {policySet.isDefault ? "Unset Default" : "Set Default"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400"
            onClick={handleDelete}
            disabled={deleting}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </button>

      {policySet.description && !expanded && (
        <div className="px-5 pb-3 -mt-2">
          <p className="text-xs text-muted-foreground/60 pl-11">{policySet.description}</p>
        </div>
      )}

      {expanded && (
        <div className="border-t border-border p-5 pt-4 space-y-3">
          {policySet.description && (
            <p className="text-sm text-muted-foreground mb-3">{policySet.description}</p>
          )}

          {loadingMembers ? (
            <div className="flex items-center gap-2 text-muted-foreground py-4 justify-center">
              <div className="w-3 h-3 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
              <span className="text-xs">Loading...</span>
            </div>
          ) : (
            <>
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Member Policies
              </p>
              {members.length === 0 ? (
                <p className="text-xs text-muted-foreground/50 text-center py-3 border border-dashed border-border rounded-lg">
                  No policies in this set yet.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {members.map((policy) => (
                    <div
                      key={policy.id}
                      className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/20 border border-border/50"
                    >
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={policy.enabled ? "success" : "secondary"}
                          className="text-[10px]"
                        >
                          {policy.enabled ? "Active" : "Off"}
                        </Badge>
                        <span className="text-sm">{policy.name}</span>
                        <span className="text-[10px] font-mono text-muted-foreground/50">
                          P:{policy.priority}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400"
                        onClick={() => handleRemoveMember(policy.id)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {availablePolicies.length > 0 && (
                <div className="pt-2">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Add Policy
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {availablePolicies.map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => handleAddMember(p.id)}
                        className="text-xs px-2.5 py-1 rounded-md border border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-accent/50 hover:border-cyan-500/30 transition-colors"
                      >
                        + {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
