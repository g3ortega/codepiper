import { Minus, Plus } from "lucide-react";
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

interface CreateEnvSetDialogProps {
  onCreated: () => void;
}

interface EnvVarRow {
  id: string;
  key: string;
  value: string;
}

let rowIdCounter = 0;
function newRow(): EnvVarRow {
  return { id: `row-${++rowIdCounter}`, key: "", value: "" };
}

export function CreateEnvSetDialog({ onCreated }: CreateEnvSetDialogProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<EnvVarRow[]>([newRow()]);

  const addRow = () => setRows([...rows, newRow()]);

  const removeRow = (index: number) => {
    if (rows.length <= 1) return;
    setRows(rows.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, field: "key" | "value", val: string) => {
    setRows(rows.map((row, i) => (i === index ? { ...row, [field]: val } : row)));
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }

    const vars: Record<string, string> = {};
    for (const row of rows) {
      if (row.key.trim()) {
        vars[row.key.trim()] = row.value;
      }
    }

    if (Object.keys(vars).length === 0) {
      toast.error("At least one variable is required");
      return;
    }

    try {
      setCreating(true);
      await api.createEnvSet({
        name: name.trim(),
        description: description.trim() || undefined,
        vars,
      });
      toast.success(`Env set "${name}" created`);
      setOpen(false);
      setName("");
      setDescription("");
      setRows([newRow()]);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create env set");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-cyan-600 hover:bg-cyan-700 text-white border-0">
          <Plus className="h-4 w-4 mr-1.5" />
          New Env Set
        </Button>
      </DialogTrigger>
      <DialogContent className="border-border bg-popover max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Env Set</DialogTitle>
          <DialogDescription className="text-muted-foreground/60">
            Define a named collection of environment variables.
          </DialogDescription>
        </DialogHeader>

        {/* Disclaimer */}
        <div className="border border-amber-500/20 bg-amber-500/[0.04] rounded-lg px-3 py-2.5">
          <p className="text-[11px] text-amber-300/80 leading-relaxed">
            Variables are encrypted at rest. Not intended for critical production secrets.
          </p>
        </div>

        <div className="space-y-4 py-1">
          <div>
            <span className="text-xs font-medium text-muted-foreground mb-1.5 block">Name</span>
            <Input
              placeholder="dev-api-keys"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-background border-border"
            />
          </div>
          <div>
            <span className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Description (optional)
            </span>
            <Input
              placeholder="API keys for development environment"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="bg-background border-border"
            />
          </div>

          <div>
            <span className="text-xs font-medium text-muted-foreground mb-2 block">Variables</span>
            <div className="space-y-2">
              {rows.map((row, i) => (
                <div key={row.id} className="flex items-center gap-2">
                  <Input
                    placeholder="KEY"
                    value={row.key}
                    onChange={(e) => updateRow(i, "key", e.target.value)}
                    className="bg-background border-border font-mono text-xs flex-[2]"
                  />
                  <span className="text-muted-foreground/40 text-xs">=</span>
                  <Input
                    type="password"
                    placeholder="value"
                    value={row.value}
                    onChange={(e) => updateRow(i, "value", e.target.value)}
                    className="bg-background border-border font-mono text-xs flex-[3]"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-red-400"
                    onClick={() => removeRow(i)}
                    disabled={rows.length <= 1}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={addRow}
              className="mt-2 text-xs h-8 border-dashed"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Variable
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={creating}
            className="bg-cyan-600 hover:bg-cyan-700 text-white border-0"
          >
            {creating ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
