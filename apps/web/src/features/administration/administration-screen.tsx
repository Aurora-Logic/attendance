import { NavLink } from 'react-router';
import { CaretRightIcon } from '@phosphor-icons/react';

import { PageHeader } from '@/components/shared/page-header';
import { SectionHeading } from '@/components/shared/section-heading';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { ADMIN_GROUPS, type NavItem } from '@/lib/nav';
import { usePermissions } from '@/lib/session/permissions';

/**
 * The workspace's own screens, in one place (REQ-O-02).
 *
 * These eight used to sit in the attendance sidebar, which was the wrong shelf:
 * there is one audit log for the whole system, one recycle bin and one set of
 * roles, and CRM will not be getting copies of them. Leaving them where they
 * were would have meant either duplicating them into every module sidebar or
 * making one module the odd owner of everything shared.
 *
 * A list of links rather than a settings surface of its own. Each destination
 * already has a screen; this exists so they are reachable and so their grouping
 * says what they are, not to wrap them in another layer of chrome.
 */

function isVisible(item: NavItem, granted: ReadonlySet<string>): boolean {
  return !item.permission || granted.has(item.permission);
}

export function AdministrationScreen() {
  const granted = usePermissions();

  const groups = ADMIN_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => isVisible(item, granted)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex flex-col gap-6">
      {/* No title: the breadcrumb in the app header states the page's name
          once, and PageHeader carries only what belongs to the screen. */}
      <PageHeader description="Settings, people and records that belong to the whole workspace rather than to one module." />

      {groups.length === 0 ? (
        /*
         * Reachable: the route is not permission-gated, because gating it would
         * mean a person following a link from an older bookmark gets "not
         * found" rather than an explanation. Every destination inside is gated
         * individually, server-side as well.
         */
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CaretRightIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing here for your account</EmptyTitle>
            <EmptyDescription>
              These screens need administration permissions. Ask an administrator if you need one of
              them.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((group) => (
            <section key={group.label} className="flex flex-col gap-3">
              <SectionHeading title={group.label} />
              {/*
                A divided list, not a grid of cards. CLAUDE.md section 3 rule 3:
                one card must not contain another, and a page is header ->
                toolbar -> content surface. Rules and spacing separate these
                perfectly well.
              */}
              <ul className="divide-border divide-y border-y">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      className="hover:bg-accent active:bg-muted focus-visible:ring-ring flex items-center gap-3 px-1 py-3 outline-none focus-visible:ring-2"
                    >
                      <item.icon className="text-muted-foreground size-5 shrink-0" />
                      <span className="min-w-0 flex-1 text-sm font-medium">{item.label}</span>
                      <CaretRightIcon className="text-muted-foreground size-4 shrink-0" />
                    </NavLink>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
