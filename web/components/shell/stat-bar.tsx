/**
 * The Nocturne stat bar (docs/design-system.md §6, Cards): equal cells,
 * each a large tabular figure with a caption under it (P7), hairlines
 * between cells.
 */

export interface Stat {
  label: string;
  value: string;
  /** For tests and deep links to one figure. */
  testId?: string;
}

export function StatBar({ stats }: { stats: Stat[] }) {
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-border-default bg-white/3 lg:grid-cols-4">
      {stats.map((stat, i) => (
        <div
          key={stat.label}
          className={`flex flex-col-reverse gap-2 border-border-subtle p-6 ${
            i > 0 ? "border-l" : ""
          } ${i >= 2 ? "max-lg:border-t" : ""} ${i === 2 ? "max-lg:border-l-0" : ""}`}
        >
          <dt className="text-xs text-text-muted">{stat.label}</dt>
          <dd data-testid={stat.testId} className="text-stat text-text-primary tabular-nums">
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
