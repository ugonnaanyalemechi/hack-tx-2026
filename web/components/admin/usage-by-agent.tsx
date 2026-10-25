import type { AgentUsage } from "@/lib/contracts/api";
import { formatCost, formatCount } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Spend per agent as a table, with each agent's share of the total drawn
 * as a single-hue meter (cobalt on a lighter cobalt track). The figures
 * sit in the table, so the meter never carries a value on its own.
 */
export function UsageByAgent({ rows }: { rows: AgentUsage[] }) {
  const total = rows.reduce((sum, r) => sum + Number(r.cost), 0);

  return (
    <Table aria-label="Spend by agent">
      <TableHeader>
        <TableRow>
          <TableHead>Agent</TableHead>
          <TableHead className="text-right">Runs</TableHead>
          <TableHead className="text-right">Spend</TableHead>
          <TableHead className="w-2/5">Share of spend</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const share = total > 0 ? Number(row.cost) / total : 0;
          const percent = Math.round(share * 100);
          return (
            <TableRow key={row.agent_id}>
              <TableCell>{row.agent_name}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCount(row.runs)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCost(row.cost)}</TableCell>
              <TableCell>
                <div className="flex items-center gap-3">
                  <div
                    className="h-2 flex-1 overflow-hidden rounded-pill bg-primary-500/16"
                    aria-hidden
                  >
                    <div
                      className="h-full rounded-r-xs bg-primary-500"
                      style={{ width: `${Math.max(share * 100, share > 0 ? 1 : 0)}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-xs text-text-secondary tabular-nums">
                    {percent}%
                  </span>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
