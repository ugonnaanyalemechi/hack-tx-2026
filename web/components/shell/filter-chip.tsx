/**
 * A filter chip (docs/design-system.md §6, Badges): a 32px secondary pill
 * that toggles; selected is white 10% fill with a 24% border.
 */

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function FilterChip({
  selected,
  className,
  ...props
}: ComponentProps<"button"> & { selected: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex h-8 items-center rounded-pill border border-white/16 px-3.5 text-sm font-medium text-text-secondary transition-colors duration-160 ease-foundry outline-none hover:border-white/24 hover:bg-white/6 hover:text-text-primary focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas aria-pressed:border-white/24 aria-pressed:bg-white/10 aria-pressed:text-text-primary",
        className
      )}
      {...props}
    />
  );
}
