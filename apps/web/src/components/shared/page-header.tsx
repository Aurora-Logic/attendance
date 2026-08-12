import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

export interface Crumb {
  label: string;
  to?: string;
}

interface PageHeaderProps {
  /**
   * The trail ending at this page. The last crumb *is* the page title and is
   * rendered as the h1 — the tuple type forbids an empty trail, so there is no
   * arrangement of props that produces a page with no name, and none that
   * produces its name twice.
   */
  crumbs: [Crumb, ...Crumb[]];
  description?: string;
  /** The primary action, rendered right-aligned (PRD §6.2). */
  action?: ReactNode;
}

/**
 * PRD §6.2: breadcrumb + primary action (right) → filter/toolbar row → content
 * surface → pagination.
 *
 * The breadcrumb carries the page name rather than repeating it in a separate
 * heading below. One component so that a screen built in week 6 is structurally
 * identical to one built in week 1 (CLAUDE.md §3 rule 4). Nothing here is
 * wrapped in a Card — the page surface is the surface.
 */
export function PageHeader({ crumbs, description, action }: PageHeaderProps) {
  const trail = crumbs.slice(0, -1);
  const current = crumbs[crumbs.length - 1] ?? crumbs[0];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Breadcrumb>
          <BreadcrumbList>
            {trail.map((crumb, index) => (
              // Separator is a sibling <li>, not a child of the item — nesting
              // one <li> inside another is invalid and confuses list semantics.
              <Fragment key={`${crumb.label}-${String(index)}`}>
                <BreadcrumbItem>
                  {crumb.to ? (
                    <BreadcrumbLink render={<Link to={crumb.to} />}>{crumb.label}</BreadcrumbLink>
                  ) : (
                    crumb.label
                  )}
                </BreadcrumbItem>
                <BreadcrumbSeparator />
              </Fragment>
            ))}

            <BreadcrumbItem>
              {/* The current crumb is the document heading. Rendered as h1
                  rather than BreadcrumbPage because that component claims
                  role="link", which would cost the page its only heading. */}
              <h1
                aria-current="page"
                className="text-foreground truncate text-sm font-medium"
              >
                {current.label}
              </h1>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>

      {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
    </div>
  );
}
