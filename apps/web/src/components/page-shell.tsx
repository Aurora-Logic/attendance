import type * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Every page is a fixed-height column: a non-scrolling title block, then one
 * scroll region. The document itself never scrolls — see AppLayout.
 */
export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex h-full min-h-0 flex-col", className)}>{children}</div>
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b p-4 md:px-6">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">{title}</h1>
        {description ? (
          <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  )
}

/**
 * The one scrolling region on the page.
 *
 * `[&>*]:shrink-0` matters: this is a column flex container with a bounded
 * height, so without it a tall sibling squeezes the cards above it and their
 * content gets clipped mid-glyph. Children may still grow (flex-1 works), they
 * just may not be compressed below their natural size.
 *
 * `overscroll-contain` stops a scroll that reaches the end here from chaining
 * to an ancestor. Padding is equal on all four sides so the gutter left of a
 * card matches the one above it, at every breakpoint.
 */
export function PageBody({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4 [&>*]:shrink-0 md:p-6",
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * For pages whose main content is itself a scroller (tables, grids) — no outer
 * scroll, the child owns it.
 */
export function PageBodyFixed({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6", className)}>
      {children}
    </div>
  )
}
