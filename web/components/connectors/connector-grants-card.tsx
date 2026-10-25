"use client";

/**
 * Active grants, connector x agent: which tools the agent may call, with
 * side-effect tools flagged (those pause for an approval card at run time).
 */

import { ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/shell/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ConnectorGrantRow } from "@/lib/contracts/connectors";
import { formatDateTime } from "@/lib/format";

export function ConnectorGrantsCard({ grants }: { grants: ConnectorGrantRow[] }) {
  return (
    <Card role="region" aria-label="Active grants">
      <CardHeader>
        <CardTitle>Active grants</CardTitle>
      </CardHeader>
      <CardContent>
        {grants.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No connectors granted yet.">
            Approved connectors show up here with the tools each agent may call.
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Connector</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Tools allowed</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Granted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.map((grant) => (
                <TableRow key={grant.id} data-testid="connector-grant">
                  <TableCell className="font-medium text-text-primary">
                    {grant.connector_name}
                  </TableCell>
                  <TableCell>{grant.agent_name}</TableCell>
                  <TableCell>
                    <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Tools allowed">
                      {grant.tools.map((tool) => (
                        <li
                          key={tool.name}
                          className="flex items-center gap-1.5 font-mono text-xs text-text-secondary"
                        >
                          {tool.name}
                          {tool.side_effect ? (
                            <StatusBadge tone="warning" className="h-5 px-2 text-[0.7rem]">
                              Changes things
                            </StatusBadge>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={grant.status === "active" ? "success" : "neutral"}>
                      {grant.status === "active" ? "Active" : "Revoked"}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-text-muted tabular-nums">
                    {grant.granted_by_name} · {formatDateTime(grant.granted_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
