/**
 * The Nocturne nav pill (docs/design-system.md §6, Navigation bar): a pill
 * container holding pill items, one of them active. Used for the top nav
 * tabs, the role switcher and section tabs such as the admin sub-nav.
 */

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PillGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-pill border border-border-default bg-white/3 p-1",
        className
      )}
      {...props}
    />
  );
}

const itemClass =
  "inline-flex h-9 items-center rounded-pill px-4 text-sm font-medium text-text-secondary transition-colors duration-160 ease-nocturne outline-none hover:bg-white/5 hover:text-text-primary focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas aria-[current=page]:bg-white/10 aria-[current=page]:text-text-primary aria-pressed:bg-white/10 aria-pressed:text-text-primary disabled:pointer-events-none disabled:text-text-disabled";

export function PillLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={itemClass}>
      {children}
    </Link>
  );
}

export function PillButton({ className, ...props }: ComponentProps<"button">) {
  return <button type="button" className={cn(itemClass, className)} {...props} />;
}
