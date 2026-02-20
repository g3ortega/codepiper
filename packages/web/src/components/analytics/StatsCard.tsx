interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
}

export function StatsCard({ title, value, subtitle, icon }: StatsCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card backdrop-blur-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </span>
        {icon}
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      {subtitle && <p className="text-xs text-muted-foreground/60 mt-1">{subtitle}</p>}
    </div>
  );
}
