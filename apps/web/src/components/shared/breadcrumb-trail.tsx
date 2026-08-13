import { Fragment } from 'react';
import { Link } from 'react-router';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import type { Crumb } from '@/lib/nav';

interface BreadcrumbTrailProps {
  crumbs: [Crumb, ...Crumb[]];
}

/**
 * The page's identity, carried in the app header. The last crumb is rendered as
 * the document's only h1: the page body no longer states its own name, so if
 * this stopped emitting a heading the app would have none at all.
 *
 * Rendered as h1 rather than BreadcrumbPage because that component claims
 * role="link", which would cost the page its heading semantics.
 *
 * Ancestors are desktop-only. At 360px a trail like "Setup / Roles and
 * permissions" crowds the search control out of a 56px header, and the sidebar
 * already answers "where am I" on a phone.
 */
export function BreadcrumbTrail({ crumbs }: BreadcrumbTrailProps) {
  const ancestors = crumbs.slice(0, -1);
  const current = crumbs[crumbs.length - 1] ?? crumbs[0];

  return (
    // data-guide anchors the guided tour's "where you are" step. On the
    // wrapper rather than the h1, so the cutout covers the whole trail
    // including the ancestor crumbs it is describing.
    <Breadcrumb data-guide="header.breadcrumb" className="min-w-0">
      <BreadcrumbList className="flex-nowrap gap-1 sm:gap-1">
        {ancestors.map((crumb, index) => (
          // The separator is a sibling <li>, not a child of the item — nesting
          // one <li> inside another is invalid and confuses the list semantics
          // screen readers rely on to announce depth.
          <Fragment key={`${crumb.label}-${String(index)}`}>
            <BreadcrumbItem className="hidden sm:inline-flex">
              {crumb.to ? (
                <BreadcrumbLink render={<Link to={crumb.to} />}>{crumb.label}</BreadcrumbLink>
              ) : (
                crumb.label
              )}
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden sm:block" />
          </Fragment>
        ))}

        <BreadcrumbItem className="min-w-0">
          {/* text-xs, matching the list it sits in. At text-sm the current page
              was 14px beside a 12px ancestor, so a two-crumb trail changed type
              size halfway along one line. The current page is distinguished by
              weight and colour instead, which is what the rest of this system
              does. */}
          <h1 aria-current="page" className="text-foreground truncate text-xs font-medium">
            {current.label}
          </h1>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
