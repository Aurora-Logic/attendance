import { Fragment } from 'react';
import { CaretDownIcon, ShieldCheckIcon } from '@phosphor-icons/react';

import { PageHeader } from '@/components/shared/page-header';
import { MfaProfileSection } from '@/features/auth/mfa-profile-section';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@/components/ui/item';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { NotificationPreferences } from '@/features/notifications';
import { humaniseEnum } from '@/lib/format';
import { useMe } from '@/lib/session/use-session';
import { PERMISSION_DESCRIPTIONS, employeeDisplayName, type PermissionKey } from '@vyuha/shared';

/**
 * The account behind the session, and exactly what it may do.
 *
 * Everything here is read from `/auth/me` and nothing is computed locally.
 * Technical design §10 makes the server's effective permission set the single
 * answer to "what can this person do", and a screen that recalculated it from
 * role names would be a second, quieter answer that could disagree.
 *
 * Three weights, top to bottom: who you are (read at a glance), what you can
 * change here (notification preferences — the one thing on this screen that
 * is yours to act on), and the reference list of permissions, which most
 * people open once. The list is folded by default because twenty-odd rows of
 * keys are the wrong thing to scroll past on a phone to reach nothing.
 *
 * It is reached from the user menu rather than the sidebar: PRD §6.1 fixes the
 * sidebar groups to Work, Records, Reports and Setup, and a personal account
 * page belongs to none of them.
 */

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const first = words[0]?.charAt(0) ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

/** The module a permission key belongs to, read from its first segment. */
const MODULE_LABELS: Record<string, string> = {
  punch: 'Punching',
  attendance: 'Attendance',
  leave: 'Leave',
  employee: 'People',
  shift: 'Shifts',
  holiday: 'Holidays',
  report: 'Reports',
  reports: 'Reports',
  settings: 'Settings',
  roles: 'Roles',
  audit: 'Audit',
  integration: 'Integrations',
  masters: 'Masters',
  receivables: 'Receivables',
  crm: 'CRM',
  sales: 'Sales',
  purchase: 'Purchase',
  access: 'Access',
};

function groupByModule(permissions: readonly PermissionKey[]): { label: string; keys: PermissionKey[] }[] {
  const groups = new Map<string, PermissionKey[]>();
  for (const key of permissions) {
    const prefix = key.split('.')[0] ?? key;
    const label = MODULE_LABELS[prefix] ?? humaniseEnum(prefix);
    groups.set(label, [...(groups.get(label) ?? []), key]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, keys]) => ({ label, keys: [...keys].sort((a, b) => a.localeCompare(b)) }));
}

export function ProfilePage() {
  const { data: me, isPending, isError, error, refetch } = useMe();

  if (isPending) {
    // The skeleton is the page's own shape: the identity row, then the
    // blocks. A skeleton that looks like something else promises the wrong
    // screen for the half-second it shows.
    return (
      <div role="status" aria-busy="true" aria-label="Loading profile" className="flex flex-col gap-6">
        <div className="flex items-start gap-4">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex flex-col gap-2 pt-1">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
            <Skeleton className="h-5 w-32" />
          </div>
        </div>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldCheckIcon />
          </EmptyMedia>
          <EmptyTitle>Could not load your profile</EmptyTitle>
          <EmptyDescription>{error.message}</EmptyDescription>
        </EmptyHeader>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void refetch();
          }}
        >
          Try again
        </Button>
      </Empty>
    );
  }

  // Unreachable behind SessionGate, which renders the sign-in screen instead of
  // the shell when there is no session. Handled anyway so the screen degrades
  // to a sentence rather than to a blank page if that ever stops being true.
  if (!me) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>Not signed in</EmptyTitle>
          <EmptyDescription>Sign in to see your profile.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const name = me.employee
    ? employeeDisplayName(me.employee.firstName, me.employee.lastName)
    : me.user.email;
  const groups = groupByModule(me.permissions);
  const permissionCount = me.permissions.length;

  return (
    <>
      <PageHeader description="The account you are signed in with, and what it is allowed to do." />

      {/* Identity. Name first, then the sign-in email, then the chips that
          qualify the account: the employee code, any status that is not the
          normal one (an active account needs no badge saying so), and the
          roles. One row, read in a glance, nothing repeated below it. */}
      <section className="flex items-start gap-4">
        <Avatar size="lg">
          <AvatarFallback>{initialsOf(name)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="truncate text-lg leading-tight font-semibold tracking-tight">{name}</h2>
          {me.employee ? <p className="text-muted-foreground truncate text-xs">{me.user.email}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {me.employee ? (
              <Badge variant="outline" className="font-mono">
                {me.employee.employeeCode}
              </Badge>
            ) : (
              // REQ-B-02: a login and an employee record are separate
              // entities. Saying so beats an unexplained dash.
              <Badge variant="outline">Not linked to an employee record</Badge>
            )}
            {me.user.status === 'ACTIVE' ? null : <Badge variant="destructive">{humaniseEnum(me.user.status)}</Badge>}
            {me.roles.map((role) => (
              <Badge key={role.id} variant="secondary">
                {role.name}
              </Badge>
            ))}
            {me.roles.length === 0 ? (
              <span className="text-muted-foreground text-xs">No role assigned — only what everyone can see.</span>
            ) : null}
          </div>
        </div>
      </section>

      <MfaProfileSection />

      <Separator />

      {/* REQ-K-04. On this screen rather than in Settings: Settings is org
          policy behind `settings.manage`, and these are choices about this one
          account, which an employee with no permissions at all still gets to
          make. */}
      <NotificationPreferences />

      <Separator />

      <Collapsible>
        {/* The whole row is the target (thumb-reach: a full-width row, not a
            chevron), and the count is on the closed state so nobody has to
            open it to learn there is nothing inside. */}
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              className="group/fold h-auto w-full min-h-11 justify-between gap-4 px-0 text-left whitespace-normal hover:bg-transparent"
            />
          }
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-semibold">
              Permissions
              <span className="text-muted-foreground ml-2 font-normal tabular-nums">{permissionCount}</span>
            </span>
            <span className="text-muted-foreground text-xs font-normal">
              The effective set the server returned. Every screen and endpoint is decided from this list, not from the role names above.
            </span>
          </span>
          <CaretDownIcon className="text-muted-foreground shrink-0 transition-transform duration-200 ease-out group-data-[panel-open]/fold:rotate-180 motion-reduce:transition-none" />
        </CollapsibleTrigger>
        <CollapsibleContent className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none">
          {permissionCount > 0 ? (
            <div className="flex flex-col gap-4 pt-3">
              {groups.map((group) => (
                <section key={group.label} className="flex flex-col gap-1.5">
                  <h3 className="text-muted-foreground text-xs font-medium">{group.label}</h3>
                  <ItemGroup role="list" className="gap-0 border">
                    {group.keys.map((permission, index) => (
                      <Fragment key={permission}>
                        {index > 0 ? <ItemSeparator className="my-0" /> : null}
                        {/* Meaning first, key second: the sentence is what a
                            person reads, the key is what they paste into a
                            question to an administrator. */}
                        <Item size="xs" role="listitem" className="min-h-9 rounded-none">
                          <ItemContent className="min-w-0 gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                            <ItemTitle className="min-w-0 text-xs font-normal">{PERMISSION_DESCRIPTIONS[permission]}</ItemTitle>
                            <ItemDescription className="font-mono text-xs sm:ml-auto sm:shrink-0">{permission}</ItemDescription>
                          </ItemContent>
                        </Item>
                      </Fragment>
                    ))}
                  </ItemGroup>
                </section>
              ))}
            </div>
          ) : (
            <Empty className="mt-3 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ShieldCheckIcon />
                </EmptyMedia>
                <EmptyTitle>No permissions</EmptyTitle>
                <EmptyDescription>
                  This account has no permissions yet. Ask an administrator to assign a role.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
