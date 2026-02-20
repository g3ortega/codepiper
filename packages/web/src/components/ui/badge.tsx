import type * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning";
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        {
          "border-cyan-500/20 bg-cyan-500/10 text-cyan-400": variant === "default",
          "border-border bg-muted/50 text-muted-foreground": variant === "secondary",
          "border-red-500/20 bg-red-500/10 text-red-400": variant === "destructive",
          "border-border text-muted-foreground": variant === "outline",
          "border-emerald-500/20 bg-emerald-500/10 text-emerald-400": variant === "success",
          "border-amber-500/20 bg-amber-500/10 text-amber-400": variant === "warning",
        },
        className
      )}
      {...props}
    />
  );
}

export { Badge };
