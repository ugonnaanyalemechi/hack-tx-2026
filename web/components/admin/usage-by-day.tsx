import type { DayUsage } from "@/lib/contracts/api";
import { formatCost, formatCount, formatDay } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const DAY_MS = 86_400_000;

/** Every calendar day from the first to the last, so gaps show as zero. */
function fillDays(rows: DayUsage[]): DayUsage[] {
  if (rows.length === 0) return [];
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const start = Date.parse(`${rows[0].day}T00:00:00Z`);
  const end = Date.parse(`${rows[rows.length - 1].day}T00:00:00Z`);
  const out: DayUsage[] = [];
  for (let t = start; t <= end; t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, runs: 0, cost: "0.000000" });
  }
  return out;
}

/**
 * Spend per day: a single-series column chart (one cobalt hue, no legend,
 * the card title names it), with the busiest day labelled and a tooltip on
 * every column. The table under it is the chart's text view.
 */
export function UsageByDay({ rows }: { rows: DayUsage[] }) {
  const days = fillDays(rows);
  const max = Math.max(...days.map((d) => Number(d.cost)), 0);
  const peak = days.find((d) => max > 0 && Number(d.cost) === max)?.day;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex h-44 items-end gap-1 border-b border-border-subtle pt-6">
        {days.map((d) => {
          const value = Number(d.cost);
          const height = max > 0 ? (value / max) * 100 : 0;
          const label = `${formatDay(d.day)}: ${formatCount(d.runs)} runs, ${formatCost(d.cost)}`;
          return (
            <div
              key={d.day}
              role="img"
              aria-label={label}
              tabIndex={0}
              className="group relative flex h-full flex-1 items-end justify-center rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              <div
                className={`w-full max-w-6 rounded-t-xs bg-primary-500 transition-colors duration-160 ease-foundry group-hover:bg-primary-400 group-focus-visible:bg-primary-400 ${
                  value > 0 ? "min-h-0.5" : ""
                }`}
                style={{ height: `${height}%` }}
              />
              {d.day === peak ? (
                <span
                  className="absolute mb-1 text-xs text-text-secondary tabular-nums"
                  style={{ bottom: `${height}%` }}
                  aria-hidden
                >
                  {formatCost(d.cost)}
                </span>
              ) : null}
              <span
                aria-hidden
                className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 rounded-sm border border-border-default bg-surface-2 px-3 py-2 text-xs whitespace-nowrap text-text-primary shadow-e2 group-hover:block group-focus-visible:block"
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="-mt-4 flex gap-1" aria-hidden>
        {days.map((d) => (
          <span key={d.day} className="flex-1 text-center text-xs text-text-muted">
            {formatDay(d.day).split(",")[0]}
          </span>
        ))}
      </div>

      <Table aria-label="Spend by day">
        <TableHeader>
          <TableRow>
            <TableHead>Day</TableHead>
            <TableHead className="text-right">Runs</TableHead>
            <TableHead className="text-right">Spend</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...rows].reverse().map((row) => (
            <TableRow key={row.day}>
              <TableCell>{formatDay(row.day)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCount(row.runs)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCost(row.cost)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
