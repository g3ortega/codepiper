import { Bot, BrainCircuit, Cpu, type LucideIcon } from "lucide-react";

interface ProviderPresentation {
  label: string;
  icon: LucideIcon;
  className: string;
  dotClassName: string;
}

const PROVIDER_PRESENTATION: Record<string, ProviderPresentation> = {
  "claude-code": {
    label: "Claude Code",
    icon: BrainCircuit,
    className:
      "border-amber-500/25 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-transparent text-amber-700 dark:text-amber-300",
    dotClassName: "bg-amber-500/85",
  },
  codex: {
    label: "Codex",
    icon: Bot,
    className:
      "border-sky-500/25 bg-gradient-to-r from-sky-500/15 via-cyan-500/10 to-transparent text-sky-700 dark:text-sky-300",
    dotClassName: "bg-sky-500/85",
  },
};

const FALLBACK_PRESENTATION: ProviderPresentation = {
  label: "Provider",
  icon: Cpu,
  className:
    "border-slate-500/25 bg-gradient-to-r from-slate-500/15 via-zinc-500/10 to-transparent text-slate-700 dark:text-slate-300",
  dotClassName: "bg-slate-500/85",
};

export function getProviderPresentation(provider: string): ProviderPresentation {
  const preset = PROVIDER_PRESENTATION[provider];
  if (preset) {
    return preset;
  }

  return {
    ...FALLBACK_PRESENTATION,
    label: provider
      .split(/[-_]/g)
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(" "),
  };
}
