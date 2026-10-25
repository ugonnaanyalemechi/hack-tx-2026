import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
        // Foundry status badges (docs/design-system.md §6, Badges): the
        // color at 12% fill, 28% border, full strength for the text.
        neutral: "h-6 rounded-pill border-white/12 bg-white/8 px-2.5 text-neutral-200",
        brand:
          "h-6 rounded-pill border-primary-400/30 bg-primary-500/18 px-2.5 text-primary-300",
        success: "h-6 rounded-pill border-success/28 bg-success/12 px-2.5 text-success",
        warning: "h-6 rounded-pill border-warning/28 bg-warning/12 px-2.5 text-warning",
        error: "h-6 rounded-pill border-error/28 bg-error/12 px-2.5 text-error",
        info: "h-6 rounded-pill border-info/28 bg-info/12 px-2.5 text-info",
        // Mono caps tag for catalog metadata (owner, built with).
        tag: "h-6 rounded-xs border-border-default bg-surface-2 px-2 font-mono text-overline tracking-overline text-text-secondary uppercase",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
