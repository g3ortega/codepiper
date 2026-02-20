import { GitBranch } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface BranchSelectorProps {
  branches: string[];
  currentBranch: string;
  selectedBase: string | null;
  onSelectBase: (branch: string | null) => void;
}

const WORKING_TREE = "__working_tree__";

export function BranchSelector({
  branches,
  currentBranch,
  selectedBase,
  onSelectBase,
}: BranchSelectorProps) {
  // Sort branches: main/master first, then alphabetically, exclude current
  const sorted = branches
    .filter((b) => b !== currentBranch)
    .sort((a, b) => {
      const aMain = a === "main" || a === "master";
      const bMain = b === "main" || b === "master";
      if (aMain && !bMain) return -1;
      if (!aMain && bMain) return 1;
      return a.localeCompare(b);
    });

  if (sorted.length === 0) return null;

  return (
    <div className="hidden sm:flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">
        vs
      </span>
      <Select
        value={selectedBase ?? WORKING_TREE}
        onValueChange={(v) => onSelectBase(v === WORKING_TREE ? null : v)}
      >
        <SelectTrigger className="h-7 w-auto min-w-[120px] max-w-[200px] gap-1.5 border-border/60 bg-muted/30 text-xs font-mono px-2">
          <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={WORKING_TREE} className="text-xs">
            Working tree
          </SelectItem>
          <SelectSeparator />
          {sorted.map((b) => (
            <SelectItem key={b} value={b} className="text-xs font-mono">
              {b}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
