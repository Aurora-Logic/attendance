import type { ReactNode } from 'react';

interface PageHeaderProps {
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
export function PageHeader({ description, action }: PageHeaderProps) {
  if (!description && !action) return null;

  return (
    <div
      // The guided tour's anchor for every screen (features/guide/tour-steps).
      // It lives on this one shared component rather than on eighteen separate
      // screens, so a screen cannot quietly lose its anchor in a refactor —
      // either every screen has one or none does, and the second is loud.
      data-guide="screen.header"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
    >
      {description ? (
        <p className="text-muted-foreground max-w-prose text-sm">{description}</p>
      ) : null}
      {action ? <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}
