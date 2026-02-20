import { Plus } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { PolicyRule } from "@/types/api";
import { RuleEditor } from "./RuleEditor";

interface CreatePolicyDialogProps {
  onCreated: () => void;
}

export function CreatePolicyDialog({ onCreated }: CreatePolicyDialogProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    priority: 0,
    enabled: true,
    rules: [] as PolicyRule[],
  });

  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast.error("Policy name is required");
      return;
    }
    if (form.rules.length === 0) {
      toast.error("At least one rule is required");
      return;
    }

    try {
      setCreating(true);
      await api.createPolicy({
        id: crypto.randomUUID(),
        name: form.name,
        description: form.description || undefined,
        priority: form.priority,
        enabled: form.enabled,
        rules: form.rules,
      });
      toast.success("Policy created");
      setOpen(false);
      setForm({ name: "", description: "", priority: 0, enabled: true, rules: [] });
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create policy");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-cyan-600 hover:bg-cyan-700 text-white border-0">
          <Plus className="h-4 w-4 mr-1.5" />
          New Policy
        </Button>
      </DialogTrigger>
      <DialogContent className="border-border bg-popover max-w-2xl max-h-[85vh] overflow-y-auto mx-4 sm:mx-auto">
        <DialogHeader>
          <DialogTitle>Create Policy</DialogTitle>
          <DialogDescription className="text-muted-foreground/60">
            Define permission rules for tool access control.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <label
                htmlFor="create-policy-name"
                className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
              >
                Name *
              </label>
              <Input
                id="create-policy-name"
                placeholder="My Policy"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="border-border bg-muted/30 text-sm placeholder:text-muted-foreground/30"
              />
            </div>
            <div className="grid gap-2">
              <label
                htmlFor="create-policy-priority"
                className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
              >
                Priority
              </label>
              <Input
                id="create-policy-priority"
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
              htmlFor="create-policy-desc"
              className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
            >
              Description
            </label>
            <Input
              id="create-policy-desc"
              placeholder="Optional description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="border-border bg-muted/30 text-sm placeholder:text-muted-foreground/30"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="enabled"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              className="rounded border-border"
            />
            <label htmlFor="enabled" className="text-sm text-muted-foreground">
              Enabled
            </label>
          </div>

          <RuleEditor rules={form.rules} onChange={(rules) => setForm((f) => ({ ...f, rules }))} />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={creating}
            className="border-border"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={creating}
            className="bg-cyan-600 hover:bg-cyan-700 text-white border-0"
          >
            {creating ? "Creating..." : "Create Policy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
