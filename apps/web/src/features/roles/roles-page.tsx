import { useState } from 'react';
import { CheckIcon, LockKeyIcon, ShieldCheckIcon } from '@phosphor-icons/react';

import { PageHeader } from '@/components/shared/page-header';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import { SectionHeading } from '@/components/shared/section-heading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { SampleDataNotice } from '@/features/attendance/sample-data-notice';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePermission, usePermissions } from '@/lib/session/permissions';
import { PERMISSIONS, type PermissionKey } from '@vyuha/shared';

import { PERMISSION_GROUPS, type Role } from './types';
import { useRoles } from './use-roles';

/**
 * REQ-B-07 / PRD §5 screen 17: roles as named bundles of permissions.
 *
 * Two tabs, because the screen answers two different questions. "Which roles
 * exist and what does each one carry" is the administrator's question and needs
 * the server. "What am I allowed to do" is everybody's question, and the answer
 * is already in the session -- so that tab shows real data even while the roles
 * endpoint does not exist.
 */

const ROLE_COLUMNS: RecordColumn<Role>[] = [
  {
    key: 'name',
    header: 'Role',
    cell: (row) => <span className="font-medium">{row.name}</span>,
  },
  {
    key: 'description',
    header: 'Description',
    cell: (row) => row.description ?? 'No description',
    secondary: true,
  },
  {
    key: 'permissions',
    header: 'Permissions',
    cell: (row) => row.permissions.length,
    numeric: true,
  },
  {
    key: 'members',
    header: 'Members',
    cell: (row) => row.memberCount,
    numeric: true,
  },
  {
    key: 'kind',
    header: 'Kind',
    cell: (row) =>
      row.isSystem ? <Badge variant="secondary">Seeded</Badge> : <Badge>Custom</Badge>,
  },
];

function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading roles" className="border">
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          aria-hidden
          className="flex min-h-9 items-center gap-4 border-b px-3 py-2.5 last:border-b-0"
        >
          <Skeleton className="h-3 w-24 shrink-0" />
          <Skeleton className="hidden h-3 w-64 shrink-0 xl:block" />
          <Skeleton className="ml-auto h-4 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function RolesPage() {
  const canManage = usePermission(PERMISSIONS.ROLES_MANAGE);

  return (
    <>
      <PageHeader description="Roles are named bundles of permissions. Nothing in the system branches on a role name." />

      <Tabs defaultValue="roles" className="gap-4">
        <TabsList>
          <TabsTrigger value="roles" className="pointer-coarse:min-h-11 px-3">
            Roles
          </TabsTrigger>
          <TabsTrigger value="permissions" className="pointer-coarse:min-h-11 px-3">
            Permissions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="roles">
          {canManage ? (
            <RolesTab />
          ) : (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LockKeyIcon />
                </EmptyMedia>
                <EmptyTitle>You cannot view the role definitions</EmptyTitle>
                <EmptyDescription>
                  This needs the roles.manage permission. Your own permissions are on the
                  Permissions tab, which needs nothing.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </TabsContent>

        <TabsContent value="permissions">
          <PermissionCatalogueTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

function RolesTab() {
  const [open, setOpen] = useState<Role | null>(null);
  const query = useRoles();
  const roles = query.data?.value.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {query.data?.sample ? <SampleDataNotice what="roles" /> : null}

      {query.isPending ? <ListSkeleton /> : null}

      {query.isError ? (
        <QueryErrorAlert
          error={query.error}
          subject="roles"
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : null}

      {query.isSuccess && roles.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShieldCheckIcon />
            </EmptyMedia>
            <EmptyTitle>No roles yet</EmptyTitle>
            <EmptyDescription>
              The seed creates Employee, Operations, HR and Admin. An organisation with no roles
              has nobody who can sign in and do anything, so this usually means the seed has not
              been run.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {roles.length > 0 ? (
        <>
          <RecordTable
            columns={ROLE_COLUMNS}
            rows={roles}
            rowKey={(row) => row.id}
            mobilePrimary={(row) => row.name}
            mobileStatus={(row) => (
              <Badge variant="secondary">{row.permissions.length} keys</Badge>
            )}
            mobileSupporting={(row) => row.description ?? 'No description'}
            onRowActivate={setOpen}
          />
          <p className="text-muted-foreground text-xs">
            Open a role to see every permission it carries.
          </p>
        </>
      ) : null}

      <RoleSheet
        role={open}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      />
    </div>
  );
}

function RoleSheet({
  role,
  onOpenChange,
}: {
  role: Role | null;
  onOpenChange: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const held = new Set(role?.permissions ?? []);

  return (
    <Sheet open={role !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className="gap-0 sm:max-w-lg max-md:max-h-[90vh]"
      >
        {role ? (
          <>
            <SheetHeader className="shrink-0 border-b">
              <SheetTitle>{role.name}</SheetTitle>
              <SheetDescription>
                {role.permissions.length} of {countAllPermissions()} permissions.{' '}
                {role.description ?? ''}
              </SheetDescription>
            </SheetHeader>

            {/* min-h-0 is load-bearing: a flex child defaults to
                min-height:auto and would grow past the sheet instead of
                scrolling inside it. */}
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
              <Alert>
                <LockKeyIcon />
                <AlertTitle>Read-only for now</AlertTitle>
                <AlertDescription>
                  REQ-B-07 makes these editable bundles, but the endpoint that saves a change
                  (PATCH /roles) is not built yet. Editing here would be a control that fails on
                  every press.
                </AlertDescription>
              </Alert>

              {PERMISSION_GROUPS.map((group) => (
                <div key={group.family} className="flex flex-col gap-2">
                  <SectionHeading title={group.label} />
                  <div className="flex flex-col gap-1">
                    {group.permissions.map((permission) => (
                      <PermissionRow
                        key={permission.key}
                        permissionKey={permission.key}
                        description={permission.description}
                        granted={held.has(permission.key)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function countAllPermissions(): number {
  return PERMISSION_GROUPS.reduce((total, group) => total + group.permissions.length, 0);
}

/**
 * One permission, with whether it is present.
 *
 * A tick and a dash rather than a disabled Checkbox. A greyed-out checkbox says
 * "you may not change this yet"; a tick says "this is how it is", which is what
 * a read-only matrix actually means.
 */
function PermissionRow({
  permissionKey,
  description,
  granted,
}: {
  permissionKey: PermissionKey;
  description: string;
  granted: boolean;
}) {
  return (
    <Item size="sm" className="min-h-11 rounded-none px-0">
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="truncate font-mono text-xs">{permissionKey}</ItemTitle>
        <ItemDescription className="truncate text-xs">{description}</ItemDescription>
      </ItemContent>
      {granted ? (
        <Badge variant="secondary">
          <CheckIcon aria-hidden />
          Granted
        </Badge>
      ) : (
        <span className="text-muted-foreground text-xs" aria-label="Not granted">
          Not granted
        </span>
      )}
    </Item>
  );
}

/**
 * The permission catalogue, marked with what the reader themselves holds.
 *
 * This is real data on a screen whose other half is not: `ALL_PERMISSIONS` is
 * the contract package, and the held set came from `/me`. It carries no sample
 * notice for that reason.
 */
function PermissionCatalogueTab() {
  const held = usePermissions();

  return (
    <div className="flex flex-col gap-4">
      <SectionHeading
        title="Every permission in the system"
        note={`You hold ${String(held.size)} of ${String(countAllPermissions())}. This comes from your session, not from the roles list.`}
      />

      <div className="flex flex-col gap-6 border p-4">
        {PERMISSION_GROUPS.map((group) => (
          <div key={group.family} className="flex flex-col gap-2">
            <SectionHeading title={group.label} />
            <div className="flex flex-col gap-1">
              {group.permissions.map((permission) => (
                <PermissionRow
                  key={permission.key}
                  permissionKey={permission.key}
                  description={permission.description}
                  granted={held.has(permission.key)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
