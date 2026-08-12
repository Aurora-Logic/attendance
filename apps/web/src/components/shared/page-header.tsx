import type { ReactNode } from 'react';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

export interface Crumb {
  label: string;
  to?: string;
}

interface PageHeaderProps {
  title: string;
  description?: string;
  crumbs?: Crumb[];
  /** The primary action, rendered right-aligned (PRD §6.2). */
  action?: ReactNode;
}

/**
 * PRD §6.2: "Every page: breadcrumb + title + primary action (right) →
 * filter/toolbar row → content surface → pagination."
 *
 * One component so that a screen built in week 6 is structurally identical to
 * one built in week 1 (CLAUDE.md §3 rule 4). Nothing here is wrapped in a
 * Card — the page surface is the surface.
 */
export function PageHeader({ title, description, crumbs, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3">
      {crumbs && crumbs.length > 0 ? (
        <Breadcrumb>
          <BreadcrumbList>
            {crumbs.map((crumb, index) => {
              const isLast = index === crumbs.length - 1;
              return (
                <BreadcrumbItem key={`${crumb.label}-${String(index)}`}>
                  {isLast || !crumb.to ? (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  ) : (
                    <>
                      <BreadcrumbLink href={crumb.to}>{crumb.label}</BreadcrumbLink>
                      <BreadcrumbSeparator />
                    </>
                  )}
                </BreadcrumbItem>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="text-muted-foreground text-sm">{description}</p>
          ) : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
    </div>
  );
}
