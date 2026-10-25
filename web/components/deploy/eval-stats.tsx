import type { EvalReportOut } from "@/lib/contracts/evals";
import type { AgentDetail } from "@/lib/contracts/registry";
import { casesPassing, formatScore } from "@/components/deploy/gate";

/**
 * Foundry stat bar: large tabular figure, caption beneath. Cost and ticket
 * counts from the mockup are out of MVP scope for the owner view.
 */
export function EvalStats({
  agent,
  report,
}: {
  agent: AgentDetail;
  report: EvalReportOut | null;
}) {
  const cases = report ? casesPassing(report) : null;
  const stats = [
    report
      ? {
          value: formatScore(report.score),
          caption: `Eval score, v${report.version_number} (needs ${formatScore(report.threshold)})`,
        }
      : { value: "—", caption: "Eval score (no test run yet)" },
    { value: cases ? `${cases.passed} of ${cases.total}` : "—", caption: "Test cases passing" },
    {
      value: agent.live_version_number !== null ? `v${agent.live_version_number}` : "None",
      caption: agent.live_version_number !== null ? "Live version" : "Not live yet",
    },
  ];

  return (
    <dl className="grid grid-cols-3 rounded-xl border border-border-default bg-white/3">
      {stats.map((stat) => (
        <div
          key={stat.caption}
          className="flex flex-col-reverse gap-2 border-l border-border-subtle p-6 first:border-l-0"
        >
          <dt className="text-xs text-text-muted">{stat.caption}</dt>
          <dd className="text-stat text-text-primary tabular-nums">{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}
