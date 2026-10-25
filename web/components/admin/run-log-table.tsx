"use client";

import Link from "next/link";
import type { RunListEntry } from "@/lib/contracts/api";
import { runHasCost } from "@/lib/contracts/api";
import { ENTRY_POINT, RUN_STATUS, formatCost, formatDuration, shortId } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * The run log: one row per run. The Cost column only appears when the API
 * sent cost, which it does only for admins and the agent's owner.
 */
export function RunLogTable({
  runs,
  agentNames,
  userNames,
  selectedRunId,
  runHref,
  onSelect,
}: {
  runs: RunListEntry[];
  agentNames: Map<string, string>;
  userNames: Map<string, string>;
  selectedRunId: string | null;
  runHref: (runId: string) => string;
  onSelect: (runId: string) => void;
}) {
  const showCost = runs.some(runHasCost);

  return (
    <Table aria-label="Runs">
      <TableHeader>
        <TableRow>
          <TableHead>Run</TableHead>
          <TableHead>Agent</TableHead>
          <TableHead>User</TableHead>
          <TableHead>Entry</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Time</TableHead>
          {showCost ? <TableHead className="text-right">Cost</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => {
          const status = RUN_STATUS[run.status];
          const selected = run.id === selectedRunId;
          return (
            <TableRow
              key={run.id}
              aria-current={selected ? "true" : undefined}
              data-state={selected ? "selected" : undefined}
              onClick={() => onSelect(run.id)}
              className="cursor-pointer"
            >
              <TableCell>
                <Link
                  href={runHref(run.id)}
                  scroll={false}
                  title={run.id}
                  onClick={(e) => {
                    e.preventDefault();
                    onSelect(run.id);
                  }}
                  className="rounded-xs font-mono text-xs text-text-secondary outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  {shortId(run.id)}
                </Link>
              </TableCell>
              <TableCell>{agentNames.get(run.agent_id) ?? shortId(run.agent_id)}</TableCell>
              <TableCell className="text-text-secondary">
                {userNames.get(run.user_id) ?? run.user_id}
              </TableCell>
              <TableCell className="text-text-secondary">{ENTRY_POINT[run.entry_point]}</TableCell>
              <TableCell>
                <Badge variant={status.tone}>{status.label}</Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatDuration(run.duration_ms)}
              </TableCell>
              {showCost ? (
                <TableCell className="text-right tabular-nums">
                  {runHasCost(run) ? formatCost(run.cost_total) : "—"}
                </TableCell>
              ) : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
