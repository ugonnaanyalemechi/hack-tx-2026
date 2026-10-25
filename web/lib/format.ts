/** Display formatting for API values. Times show in UTC, as stored. */

import type { DecimalString, EntryPoint, IsoDate, IsoDateTime, RunStatus } from "@/lib/contracts/api";

/** "$0.031". Amounts too small to show at this precision read "<$0.001". */
export function formatCost(value: DecimalString, fractionDigits = 3): string {
  const amount = Number(value);
  const smallest = 10 ** -fractionDigits;
  if (amount > 0 && amount < smallest) return `<$${smallest.toFixed(fractionDigits)}`;
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

/** "12ms", "0.9s", "4.1s", "1m 05s"; null (still running or waiting) reads "—". */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 100) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

const dateTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "Oct 25, 14:12 UTC". */
export function formatDateTime(value: IsoDateTime): string {
  return `${dateTime.format(new Date(value))} UTC`;
}

const dayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});

/** "Sun, Oct 25". */
export function formatDay(value: IsoDate): string {
  return dayFormat.format(new Date(`${value}T00:00:00Z`));
}

/** "run_8f2a" for "run_8f2a3c9e…": prefix plus four characters. */
export function shortId(id: string): string {
  const split = id.indexOf("_");
  return split === -1 ? id.slice(0, 8) : id.slice(0, split + 5);
}

export type Tone = "neutral" | "brand" | "success" | "warning" | "error" | "info";

export const RUN_STATUS: Record<RunStatus, { label: string; tone: Tone }> = {
  running: { label: "Running", tone: "info" },
  awaiting_approval: { label: "Awaiting approval", tone: "warning" },
  paused: { label: "Paused", tone: "error" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "error" },
};

export const ENTRY_POINT: Record<EntryPoint, string> = {
  chat: "Chat",
  api: "API",
  recheck: "Re-check",
  eval: "Eval",
};
