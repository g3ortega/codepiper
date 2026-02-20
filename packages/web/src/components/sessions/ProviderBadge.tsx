import { getProviderPresentation } from "@/lib/providerPresentation";
import { cn } from "@/lib/utils";

interface ProviderBadgeProps {
  provider: string;
  compact?: boolean;
  className?: string;
}

export function ProviderBadge({ provider, compact = false, className }: ProviderBadgeProps) {
  const visual = getProviderPresentation(provider);
  const Icon = visual.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium backdrop-blur-[1px] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] transition-colors dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        compact ? "gap-1 px-2 py-0.5 text-[10px]" : "gap-1.5 px-2.5 py-1 text-[11px]",
        visual.className,
        className
      )}
    >
      <span className={cn("inline-block h-1.5 w-1.5 rounded-full", visual.dotClassName)} />
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-full border border-current/20 bg-background/70",
          compact ? "h-4 w-4" : "h-[18px] w-[18px]"
        )}
      >
        <Icon className={cn("shrink-0", compact ? "h-2.5 w-2.5" : "h-3 w-3")} />
      </span>
      <span className={cn("leading-none", compact ? "max-w-[80px] truncate" : "")}>
        {visual.label}
      </span>
    </span>
  );
}
