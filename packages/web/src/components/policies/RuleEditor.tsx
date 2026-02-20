import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PolicyRule } from "@/types/api";

interface RuleEditorProps {
  rules: PolicyRule[];
  onChange: (rules: PolicyRule[]) => void;
}

export function RuleEditor({ rules, onChange }: RuleEditorProps) {
  const addRule = () => {
    onChange([
      ...rules,
      {
        id: crypto.randomUUID(),
        action: "allow",
        tool: "",
        reason: "",
      },
    ]);
  };

  const updateRule = (index: number, updates: Partial<PolicyRule>) => {
    const next = [...rules];
    next[index] = { ...next[index], ...updates };
    onChange(next);
  };

  const removeRule = (index: number) => {
    onChange(rules.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Rules</p>
        <Button type="button" variant="ghost" size="sm" onClick={addRule} className="h-7 text-xs">
          <Plus className="h-3 w-3 mr-1" />
          Add Rule
        </Button>
      </div>

      {rules.length === 0 && (
        <p className="text-xs text-muted-foreground/50 text-center py-4 border border-dashed border-border rounded-lg">
          No rules yet. Add a rule to define permission behavior.
        </p>
      )}

      {rules.map((rule, i) => (
        <div
          key={rule.id}
          className="grid grid-cols-[100px_1fr_1fr_32px] gap-2 items-start p-3 rounded-lg border border-border bg-muted/20"
        >
          <Select
            value={rule.action}
            onValueChange={(v) => updateRule(i, { action: v as PolicyRule["action"] })}
          >
            <SelectTrigger className="h-8 text-xs border-border bg-muted/30">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="allow">Allow</SelectItem>
              <SelectItem value="deny">Deny</SelectItem>
              <SelectItem value="ask">Ask</SelectItem>
            </SelectContent>
          </Select>

          <Input
            placeholder="Tool pattern (e.g. Bash, Write)"
            value={typeof rule.tool === "string" ? rule.tool : (rule.tool || []).join(", ")}
            onChange={(e) => updateRule(i, { tool: e.target.value })}
            className="h-8 text-xs border-border bg-muted/30 font-mono placeholder:text-muted-foreground/30"
          />

          <Input
            placeholder="Reason (optional)"
            value={rule.reason || ""}
            onChange={(e) => updateRule(i, { reason: e.target.value })}
            className="h-8 text-xs border-border bg-muted/30 placeholder:text-muted-foreground/30"
          />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-red-400"
            onClick={() => removeRule(i)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
