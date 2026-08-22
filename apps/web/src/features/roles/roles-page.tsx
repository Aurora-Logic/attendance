import { useState } from 'react';
import {
  CheckIcon,
  ListChecksIcon,
  LockKeyIcon,
  PlusIcon,
  ShieldCheckIcon,
} from '@phosphor-icons/react';

import { PageHeader } from '@/components/shared/page-header';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import { SectionHeading } from '@/components/shared/section-heading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { usePermission, usePermissions } from '@/lib/session/permissions';
import { PERMISSIONS, type PermissionKey } from '@vyuha/shared';

import { RoleEditorSheet } from './role-editor-sheet';
import { PERMISSION_GROUPS, countAllPermissions, type Role } from './types';
import { useRoles } from './use-roles';

/**
 * REQ-B-07 / PRD §5 screen 17: roles as named bundles of permissions.
 *
 * Two tabs, because the screen answers two different questions. "Which roles
 * exist and what does each one carry" is the administrator's question and needs
 * `roles.manage`. "What am I allowed to do" is everybody's question, and the
 * answer is already in the session — so that tab needs no permission at all.
 *
 * P2-3 recorded that this screen was read-only because `PATCH /roles` did not
 * exist. It does now, and every write goes through a confirm step that takes a
 * typed reason.
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
      <PageHeader description="Roles are named bundles of permissions. Nothing in the system branches on a role name, and every change takes a reason." />

      <Tabs defaultValue="roles" className="gap-4">
        <TabsList>
          <TabsTrigger value="roles" className="pointer-coarse:min-h-11 px-3">
            <ShieldCheckIcon data-icon="inline-start" />
            Roles
          </TabsTrigger>
          <TabsTrigger value="permissions" className="pointer-coarse:min-h-11 px-3">
            <ListChecksIcon data-icon="inline-start" />
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
  const [editing, setEditing] = useState<Role | null>(null);
  const [open, setOpen] = useState(false);
  const query = useRoles();
  const roles = query.data?.data ?? [];

  function openRole(role: Role | null) {
    setEditing(role);
    setOpen(true);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar row (PRD §6.2). */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          onClick={() => {
            openRole(null);
          }}
        >
          <PlusIcon data-icon="inline-start" />
          New role
        </Button>
      </div>

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
            mobileStatus={(row) => <Badge variant="secondary">{row.permissions.length} keys</Badge>}
            mobileSupporting={(row) => row.description ?? 'No description'}
            onRowActivate={openRole}
          />
          <p className="text-muted-foreground text-xs">
            Open a role to change what it carries. Seeded roles can be edited but not renamed or
            deleted.
          </p>
        </>
      ) : null}

      <RoleEditorSheet role={editing} open={open} onOpenChange={setOpen} canManage />
    </div>
  );
}

/**
 * One permission, with whether the reader holds it.
 *
 * A tick and a phrase rather than a disabled checkbox. A greyed-out checkbox
 * says "you may not change this yet"; this tab is not about changing anything,
 * it is about telling somebody what they can currently do.
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
 * `ALL_PERMISSIONS` is the contract package and the held set came from `/me`,
 * so this tab is real data whatever the roles endpoint is doing.
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
