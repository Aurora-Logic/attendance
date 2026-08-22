import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** A small muted line above the title: the category a report belongs to. */
  eyebrow?: string;
  /**
   * The subject chosen within the page — a report's name — when the
   * breadcrumb can only say which screen this is. Not the page's h1: the
   * breadcrumb carries that, and this is a control or a label below it.
   */
  title?: ReactNode;
  description?: string;
  /** The primary action, rendered right-aligned (PRD §6.2). */
  action?: ReactNode;
}

/**
 * PRD §6.2 page structure, minus the name. The page's identity is stated once,
 * by the breadcrumb in the app header (BreadcrumbTrail), so this row carries
 * only what belongs to the screen itself: its description and primary action.
 *
 * Renders nothing when it has neither, rather than leaving an empty row that
 * silently adds a gap to every page that does not need one.
 *
 * One component, so a screen built in week 6 is structurally identical to one
 * built in week 1 (CLAUDE.md §3 rule 4). Nothing here is wrapped in a Card —
 * the page surface is the surface (rule 3).
 */
export function PageHeader({ eyebrow, title, description, action }: PageHeaderProps) {
  if (!eyebrow && !title && !description && !action) return null;

  return (
    <div
      // The guided tour's anchor for every screen (features/guide/tour-steps).
      // It lives on this one shared component rather than on eighteen separate
      // screens, so a screen cannot quietly lose its anchor in a refactor —
      // either every screen has one or none does, and the second is loud.
      data-guide="screen.header"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
    >
      {eyebrow || title || description ? (
        <div className="flex min-w-0 flex-col gap-0.5">
          {eyebrow ? <p className="text-muted-foreground text-xs font-medium">{eyebrow}</p> : null}
          {title ? <div className="flex min-w-0 items-center text-base font-semibold">{title}</div> : null}
          {description ? <p className="text-muted-foreground max-w-prose text-sm">{description}</p> : null}
        </div>
      ) : null}
      {action ? <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}
