import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { Policy, PolicyRule } from "@/types/api";
import { RuleEditor } from "./RuleEditor";

interface EditPolicyDialogProps {
  policy: Policy;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function EditPolicyDialog({ policy, open, onOpenChange, onSaved }: EditPolicyDialogProps) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: policy.name,
    description: policy.description || "",
    priority: policy.priority,
    enabled: policy.enabled,
    rules: [...policy.rules] as PolicyRule[],
  });

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Policy name is required");
      return;
    }

    try {
      setSaving(true);
      await api.updatePolicy(policy.id, {
        name: form.name,
        description: form.description || undefined,
        priority: form.priority,
        enabled: form.enabled,
        rules: form.rules,
      });
      toast.success("Policy updated");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update policy");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Policy</DialogTitle>
          <DialogDescription className="text-muted-foreground/60">
            Modify the permission rules for this policy.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <label
                htmlFor="edit-policy-name"
                className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
              >
                Name *
              </label>
              <Input
                id="edit-policy-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="border-border bg-muted/30 text-sm"
              />
            </div>
            <div className="grid gap-2">
              <label
                htmlFor="edit-policy-priority"
                className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
              >
                Priority
              </label>
              <Input
                id="edit-policy-priority"
                type="number"
                value={form.priority}
                onChange={(e) =>
                  setForm((f) => ({ ...f, priority: parseInt(e.target.value, 10) || 0 }))
                }
                className="border-border bg-muted/30 text-sm font-mono"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <label
              htmlFor="edit-policy-desc"
              className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
            >
              Description
            </label>
            <Input
              id="edit-policy-desc"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="border-border bg-muted/30 text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="edit-enabled"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              className="rounded border-border"
            />
            <label htmlFor="edit-enabled" className="text-sm text-muted-foreground">
              Enabled
            </label>
          </div>

          <RuleEditor rules={form.rules} onChange={(rules) => setForm((f) => ({ ...f, rules }))} />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-border"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-cyan-600 hover:bg-cyan-700 text-white border-0"
          >
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
