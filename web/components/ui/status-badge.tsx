import { cn } from "cn";
import { Badge } from "@/components/ui/badge";

/**
 * Foundry status badge (docs/design-system.md §6, Badges): 24px pill with a
 * 6px dot, the tone's color as text, at 12% as fill and 28% as border.
 * Badges report status and are not buttons.
 */
const TONES = {
  neutral: "border-white/12 bg-white/8 text-neutral-200",
  brand: "border-primary-400/30 bg-primary-500/18 text-text-brand",
  success: "border-success/28 bg-success/12 text-success",
  warning: "border-warning/28 bg-warning/12 text-warning",
  error: "border-error/28 bg-error/12 text-error",
  info: "border-info/28 bg-info/12 text-info",
} as const;

export type StatusTone = keyof typeof TONES;

export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("h-6 gap-1.5 rounded-pill px-2.5 text-xs font-medium", TONES[tone], className)}
    >
      <span className="size-1.5 rounded-pill bg-current" aria-hidden />
      {children}
    </Badge>
  );
}
