import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

function ThemeSwatch({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-4 w-4 rounded-full border border-border/70 shadow-[0_0_0_1px_hsl(var(--background))] shrink-0",
        className
      )}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

export function ThemeMenuButton({ className }: { className?: string }) {
  const { theme, themes, setTheme } = useTheme();
  const triggerSurfaceClass =
    theme.mode === "dark"
      ? "bg-card/65 backdrop-blur-sm hover:bg-accent/70"
      : "bg-card/92 hover:bg-accent/85";
  const menuSurfaceClass =
    theme.mode === "dark"
      ? "bg-popover/95 backdrop-blur-xl shadow-[0_24px_48px_-24px_hsl(var(--foreground)/0.45)]"
      : "bg-popover shadow-[0_20px_40px_-22px_hsl(var(--foreground)/0.22)]";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "h-8 w-8 rounded-lg border border-border/70 flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/45 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            triggerSurfaceClass,
            className
          )}
          aria-label={`Theme picker (current: ${theme.label})`}
          title={`Theme: ${theme.label}`}
        >
          <ThemeSwatch color={theme.ui.primary} className="h-3.5 w-3.5 border-border/80" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={cn("w-72 border-border/70", menuSurfaceClass)}>
        <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
          Theme
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={theme.id} onValueChange={setTheme}>
          {themes.map((candidate) => (
            <DropdownMenuRadioItem
              key={candidate.id}
              value={candidate.id}
              className="pl-2 pr-2 py-2 rounded-md border border-transparent focus:bg-accent/70 data-[state=checked]:border-primary/35 data-[state=checked]:bg-primary/10 [&>span:first-child]:hidden"
            >
              <div className="flex w-full items-center gap-2.5">
                <ThemeSwatch color={candidate.ui.primary} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{candidate.label}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {candidate.description}
                  </div>
                </div>
                <span
                  className={cn(
                    "ml-auto h-2 w-2 rounded-full border border-border/70",
                    theme.id === candidate.id ? "bg-primary border-primary/50" : "bg-transparent"
                  )}
                />
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
