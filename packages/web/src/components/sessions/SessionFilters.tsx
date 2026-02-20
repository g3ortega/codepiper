import { Search } from "lucide-react";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

interface SessionFiltersProps {
  statusFilter: string;
  providerFilter: string;
  providerOptions: Array<{ value: string; label: string }>;
  searchQuery: string;
  onStatusChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onSearchChange: (value: string) => void;
}

export function SessionFilters({
  statusFilter,
  providerFilter,
  providerOptions,
  searchQuery,
  onStatusChange,
  onProviderChange,
  onSearchChange,
}: SessionFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4 md:mb-6">
      <div className="flex-1 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
        <Input
          placeholder="Search sessions..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-9 border-border bg-muted/30 placeholder:text-muted-foreground/30"
        />
      </div>

      <Select value={statusFilter} onValueChange={onStatusChange}>
        <SelectTrigger className="sm:w-[160px] border-border bg-muted/30 text-xs sm:text-sm">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="RUNNING">Running</SelectItem>
          <SelectItem value="STARTING">Starting</SelectItem>
          <SelectItem value="STOPPED">Stopped</SelectItem>
          <SelectItem value="CRASHED">Crashed</SelectItem>
          <SelectItem value="NEEDS_PERMISSION">Needs Permission</SelectItem>
          <SelectItem value="NEEDS_INPUT">Needs Input</SelectItem>
        </SelectContent>
      </Select>

      <Select value={providerFilter} onValueChange={onProviderChange}>
        <SelectTrigger className="sm:w-[170px] border-border bg-muted/30 text-xs sm:text-sm">
          <SelectValue placeholder="Provider" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Providers</SelectItem>
          {providerOptions.map((provider) => (
            <SelectItem key={provider.value} value={provider.value}>
              {provider.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
