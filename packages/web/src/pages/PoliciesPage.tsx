import { Layers, Scale, Shield } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AuditLogTable } from "@/components/policies/AuditLogTable";
import { CreatePolicyDialog } from "@/components/policies/CreatePolicyDialog";
import { CreatePolicySetDialog } from "@/components/policies/CreatePolicySetDialog";
import { PolicyCard } from "@/components/policies/PolicyCard";
import { PolicySetCard } from "@/components/policies/PolicySetCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { Policy, PolicySetSummary } from "@/types/api";

export function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [policySets, setPolicySets] = useState<PolicySetSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [policiesRes, setsRes] = await Promise.all([api.getPolicies(), api.getPolicySets()]);
      setPolicies(policiesRes.policies);
      setPolicySets(setsRes.policySets);
    } catch {
      toast.error("Failed to load policy data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="p-4 md:p-8 max-w-7xl mx-auto">
        <div className="flex justify-center items-center h-64">
          <div className="flex items-center gap-3 text-muted-foreground">
            <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
            <span className="text-sm">Loading policies...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Policies</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Permission rules, policy sets, and audit trail
        </p>
      </div>

      <Tabs defaultValue="policies">
        <TabsList className="bg-muted/50 border border-border mb-6">
          <TabsTrigger
            value="policies"
            className="data-[state=active]:bg-background data-[state=active]:text-foreground text-sm gap-1.5"
          >
            <Shield className="h-3.5 w-3.5" />
            Policies
          </TabsTrigger>
          <TabsTrigger
            value="sets"
            className="data-[state=active]:bg-background data-[state=active]:text-foreground text-sm gap-1.5"
          >
            <Layers className="h-3.5 w-3.5" />
            Policy Sets
          </TabsTrigger>
          <TabsTrigger
            value="audit"
            className="data-[state=active]:bg-background data-[state=active]:text-foreground text-sm gap-1.5"
          >
            <Scale className="h-3.5 w-3.5" />
            Audit Log
          </TabsTrigger>
        </TabsList>

        {/* Policies Tab */}
        <TabsContent value="policies">
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-muted-foreground">
              {policies.length} {policies.length === 1 ? "policy" : "policies"} configured
            </p>
            <CreatePolicyDialog onCreated={loadData} />
          </div>

          {policies.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 rounded-xl border border-border bg-card/80">
              <Shield className="h-10 w-10 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground mb-1">No policies configured</p>
              <p className="text-xs text-muted-foreground/60">
                Create your first policy to control tool permissions.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {policies.map((policy) => (
                <PolicyCard key={policy.id} policy={policy} onUpdated={loadData} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Policy Sets Tab */}
        <TabsContent value="sets">
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-muted-foreground">
              {policySets.length} {policySets.length === 1 ? "set" : "sets"} configured
            </p>
            <CreatePolicySetDialog policies={policies} onCreated={loadData} />
          </div>

          {policySets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 rounded-xl border border-border bg-card/80">
              <Layers className="h-10 w-10 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground mb-1">No policy sets</p>
              <p className="text-xs text-muted-foreground/60">
                Group policies into sets for easy application to sessions.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {policySets.map((set) => (
                <PolicySetCard
                  key={set.id}
                  policySet={set}
                  allPolicies={policies}
                  onUpdated={loadData}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Audit Log Tab */}
        <TabsContent value="audit">
          <AuditLogTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}
