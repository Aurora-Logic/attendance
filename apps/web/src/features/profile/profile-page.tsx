import { Fragment } from 'react';
import { ShieldCheckIcon } from '@phosphor-icons/react';

import { PageHeader } from '@/components/shared/page-header';
import { SectionHeading } from '@/components/shared/section-heading';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
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
import { EMPTY_VALUE, humaniseEnum } from '@/lib/format';
import { useMe } from '@/lib/session/use-session';
import { PERMISSION_DESCRIPTIONS, employeeDisplayName } from '@vyuha/shared';

/**
 * The account behind the session, and exactly what it may do.
 *
 * Everything here is read from `/auth/me` and nothing is computed locally.
 * Technical design §10 makes the server's effective permission set the single
 * answer to "what can this person do", and a screen that recalculated it from
 * role names would be a second, quieter answer that could disagree.
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

function DetailRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="text-muted-foreground w-40 shrink-0 text-xs">{label}</dt>
      <dd className="min-w-0 text-xs break-words">
        {value}
        {note ? <span className="text-muted-foreground ml-2">{note}</span> : null}
      </dd>
    </div>
  );
}

export function ProfilePage() {
  const { data: me, isPending } = useMe();

  if (isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading profile" className="flex flex-col gap-4">
        <Skeleton className="h-10 w-10 rounded-full" />
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-3 w-64" />
      </div>
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
  const permissions = [...me.permissions].sort((a, b) => a.localeCompare(b));

  return (
    <>
      <PageHeader description="The account you are signed in with, and what it is allowed to do." />

      <section className="flex flex-col gap-4">
        {/* The name only. An account with no employee record falls back to its
            email for a name, and printing the email again underneath gave the
            page the same string three times over — the list below is where
            each field is stated once. */}
        <div className="flex items-center gap-3">
          <Avatar size="lg">
            <AvatarFallback>{initialsOf(name)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 truncate text-sm font-medium">{name}</span>
        </div>

        <dl className="flex flex-col gap-2">
          <DetailRow label="Work email" value={me.user.email} />
          <DetailRow
            label="Employee code"
            value={me.employee?.employeeCode ?? EMPTY_VALUE}
            note={
              me.employee
                ? undefined
                : // REQ-B-02: a login and an employee record are separate
                  // entities. Saying so beats an unexplained dash.
                  'This login is not linked to an employee record.'
            }
          />
          <DetailRow label="Account status" value={humaniseEnum(me.user.status)} />
        </dl>
      </section>

      <Separator />

      {/* REQ-K-04. On this screen rather than in Settings: Settings is org
          policy behind `settings.manage`, and these are choices about this one
          account, which an employee with no permissions at all still gets to
          make. */}
      <NotificationPreferences />

      <Separator />

      <section className="flex flex-col gap-3">
        <SectionHeading
          title="Roles"
          note="Roles are named bundles of permissions. Nothing in the product branches on the name itself."
        />
        {me.roles.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {me.roles.map((role) => (
              <Badge key={role.id} variant="secondary">
                {role.name}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            No role is assigned, so this account can only see what everyone can see.
          </p>
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <SectionHeading
          title="Permissions"
          note="The effective set the server returned. Every screen and every endpoint is decided from this list, not from the roles above."
        />
        {permissions.length > 0 ? (
          <ItemGroup role="list" className="gap-0 border">
            {permissions.map((permission, index) => (
              <Fragment key={permission}>
                {index > 0 ? <ItemSeparator className="my-0" /> : null}
                {/* Key and meaning on one line above 640px. Twenty-two rows of
                    two-line cards is a page you scroll rather than a list you
                    scan, and PRD §6.3 asks for density. */}
                <Item size="xs" role="listitem" className="min-h-9 rounded-none">
                  <ItemContent className="min-w-0 gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                    <ItemTitle className="font-mono text-xs font-normal sm:w-52 sm:shrink-0">
                      {permission}
                    </ItemTitle>
                    <ItemDescription className="min-w-0 text-xs">
                      {PERMISSION_DESCRIPTIONS[permission]}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              </Fragment>
            ))}
          </ItemGroup>
        ) : (
          <Empty className="border">
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
      </section>
    </>
  );
}
