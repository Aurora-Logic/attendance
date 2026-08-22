import { useMemo, useState } from 'react';
import { InfoIcon, PlusIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { ReasonDialog } from '@/components/shared/reason-dialog';
import { SectionHeading } from '@/components/shared/section-heading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { toast } from '@/components/ui/toast';
import { useIsMobile } from '@/hooks/use-mobile';
import type { PermissionKey } from '@vyuha/shared';

import {
  PERMISSION_GROUPS,
  countAllPermissions,
  samePermissionSet,
  type Role,
} from './types';
import { useCreateRole, useDeleteRole, useUpdateRole } from './use-roles';

/**
 * REQ-B-07's editor: a role's name, description and permission set.
 *
 * Saving opens a reason dialog rather than writing straight away. That is the
 * "with comments" the whole slice is about, and putting it in the confirm step
 * rather than as a field in the form is deliberate — a reason box sitting above
 * a long checkbox list gets filled in before the change is decided, and reads
 * "changing permissions" for every edit anybody ever makes.
 *
 * A seeded role can have its permissions and description edited but not its
 * name (the seed reconciles by name), and cannot be deleted. Both are stated on
 * the screen next to the disabled control rather than discovered by pressing.
 */

interface RoleEditorSheetProps {
  /** Null with `open` means create; a role means edit. */
  role: Role | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
}

export function RoleEditorSheet({ role, open, onOpenChange, canManage }: RoleEditorSheetProps) {
  const isMobile = useIsMobile();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className="gap-0 sm:max-w-lg max-md:max-h-[90vh]"
      >
        {/* Keyed so the draft belongs to the role that was opened, not to
            whichever was opened first. */}
        {open ? (
          <RoleEditorBody
            key={role?.id ?? 'new'}
            role={role}
            canManage={canManage}
            onDone={() => {
              onOpenChange(false);
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

type PendingAction = 'save' | 'delete' | null;

function RoleEditorBody({
  role,
  canManage,
  onDone,
}: {
  role: Role | null;
  canManage: boolean;
  onDone: () => void;
}) {
  const creating = role === null;

  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selected, setSelected] = useState<ReadonlySet<PermissionKey>>(
    () => new Set(role?.permissions ?? []),
  );
  const [confirming, setConfirming] = useState<PendingAction>(null);

  const create = useCreateRole();
  const update = useUpdateRole();
  const remove = useDeleteRole();

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const chosen = useMemo(() => [...selected].sort(), [selected]);

  const nameChanged = !creating && trimmedName !== role.name;
  const descriptionChanged = !creating && trimmedDescription !== (role.description ?? '');
  const permissionsChanged = creating || !samePermissionSet(chosen, role.permissions);
  const dirty = creating || nameChanged || descriptionChanged || permissionsChanged;

  const nameTooShort = trimmedName.length < 2;
  const nameLocked = !creating && role.isSystem;

  function toggle(key: PermissionKey, next: boolean) {
    setSelected((current) => {
      const copy = new Set(current);
      if (next) copy.add(key);
      else copy.delete(key);
      return copy;
    });
  }

  function submit(reason: string) {
    if (creating) {
      create.mutate(
        {
          name: trimmedName,
          description: trimmedDescription.length > 0 ? trimmedDescription : null,
          permissions: chosen,
          reason,
        },
        {
          onSuccess: (created) => {
            toast.add({
              type: 'success',
              title: `${created.name} created`,
              description: `${String(created.permissions.length)} permissions. Your reason is in the audit log.`,
            });
            setConfirming(null);
            onDone();
          },
        },
      );
      return;
    }

    update.mutate(
      {
        id: role.id,
        // Only what changed. Sending an unchanged name would make the server
        // refuse a seeded role for a rename nobody asked for.
        ...(nameChanged ? { name: trimmedName } : {}),
        ...(descriptionChanged
          ? { description: trimmedDescription.length > 0 ? trimmedDescription : null }
          : {}),
        ...(permissionsChanged ? { permissions: chosen } : {}),
        reason,
      },
      {
        onSuccess: (saved) => {
          toast.add({
            type: 'success',
            title: `${saved.name} saved`,
            description: `${String(saved.permissions.length)} permissions. Your reason is in the audit log.`,
          });
          setConfirming(null);
          onDone();
        },
      },
    );
  }

  function submitDelete(reason: string) {
    if (role === null) return;
    remove.mutate(
      { id: role.id, reason },
      {
        onSuccess: () => {
          toast.add({
            type: 'success',
            title: `${role.name} deleted`,
            description: 'It is in the recycle bin and can be restored.',
          });
          setConfirming(null);
          onDone();
        },
      },
    );
  }

  return (
    <>
      <SheetHeader className="shrink-0 border-b">
        <SheetTitle>{creating ? 'New role' : role.name}</SheetTitle>
        <SheetDescription>
          {creating
            ? 'A named bundle of permissions. Nothing in the system branches on its name.'
            : `${String(chosen.length)} of ${String(countAllPermissions())} permissions, held by ${String(role.memberCount)} active ${role.memberCount === 1 ? 'account' : 'accounts'}.`}
        </SheetDescription>
      </SheetHeader>

      {/* min-h-0 is load-bearing: a flex child defaults to min-height:auto and
          would grow past the sheet instead of scrolling inside it. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {!canManage ? (
          <Alert>
            <WarningCircleIcon />
            <AlertTitle>Read-only</AlertTitle>
            <AlertDescription>
              Changing a role needs the roles.manage permission, which your account does not hold.
            </AlertDescription>
          </Alert>
        ) : null}

        {nameLocked ? (
          <Alert>
            <InfoIcon />
            <AlertTitle>This is a seeded role</AlertTitle>
            <AlertDescription>
              Its permissions and description are editable. Its name is not, and it cannot be
              deleted — the seed reconciles roles by name, so a rename would create a second one
              on the next run. Re-seeding also resets a seeded role&apos;s permissions back to the
              shipped matrix.
            </AlertDescription>
          </Alert>
        ) : null}

        <Field>
          <FieldLabel htmlFor="role-name">Name</FieldLabel>
          <Input
            id="role-name"
            value={name}
            disabled={!canManage || nameLocked}
            maxLength={60}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <FieldDescription>
            {nameLocked
              ? 'Fixed, because the seed matches on it.'
              : 'At least two characters, unique in this organisation.'}
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="role-description">Description</FieldLabel>
          <Input
            id="role-description"
            value={description}
            disabled={!canManage}
            maxLength={240}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
          <FieldDescription>One line saying who this role is for. Optional.</FieldDescription>
        </Field>

        {PERMISSION_GROUPS.map((group) => (
          <div key={group.family} className="flex flex-col gap-2">
            <SectionHeading title={group.label} />
            <div className="flex flex-col gap-1">
              {group.permissions.map((permission) => (
                <PermissionToggle
                  key={permission.key}
                  permissionKey={permission.key}
                  description={permission.description}
                  checked={selected.has(permission.key)}
                  disabled={!canManage}
                  onCheckedChange={(next) => {
                    toggle(permission.key, next);
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t">
        {!creating && canManage ? (
          <Button
            variant="outline"
            className="mr-auto"
            disabled={role.isSystem}
            title={
              role.isSystem
                ? 'A seeded role cannot be deleted; the seed would recreate it.'
                : undefined
            }
            onClick={() => {
              remove.reset();
              setConfirming('delete');
            }}
          >
            <TrashIcon data-icon="inline-start" />
            Delete
          </Button>
        ) : null}
        <Button variant="outline" onClick={onDone}>
          <ACTION_ICONS.close data-icon="inline-start" />
          Close
        </Button>
        <Button
          disabled={!canManage || !dirty || nameTooShort}
          onClick={() => {
            create.reset();
            update.reset();
            setConfirming('save');
          }}
        >
          {creating ? <PlusIcon data-icon="inline-start" /> : null}
          {creating ? 'Create' : 'Save'}
        </Button>
      </SheetFooter>

      <ReasonDialog
        open={confirming === 'save'}
        onOpenChange={(next) => {
          if (!next) setConfirming(null);
        }}
        title={creating ? `Create ${trimmedName || 'this role'}?` : `Save ${role?.name ?? ''}?`}
        description="A role change takes effect on the holder's very next request, without them signing in again."
        consequences={describeChange({
          creating,
          role,
          chosen,
          nameChanged,
          descriptionChanged,
          permissionsChanged,
        })}
        prompt="Why is this changing?"
        hint="Six months from now this is the only record of why somebody gained or lost an ability."
        confirmLabel={creating ? 'Create role' : 'Save changes'}
        pendingLabel={creating ? 'Creating' : 'Saving'}
        pending={create.isPending || update.isPending}
        error={create.error ?? update.error}
        onConfirm={submit}
      />

      <ReasonDialog
        open={confirming === 'delete'}
        onOpenChange={(next) => {
          if (!next) setConfirming(null);
        }}
        title={`Delete ${role?.name ?? ''}?`}
        description="The role goes to the recycle bin. Nothing is hard-deleted."
        consequences={[
          'It disappears from the role list and from the assignment picker.',
          'It is refused while any active account still holds it, and the refusal names them.',
          'Restoring it later brings its permission set back exactly as it is now.',
        ]}
        prompt="Why is this role being deleted?"
        hint="Stored on the deletion record and shown in the recycle bin."
        confirmLabel="Delete role"
        pendingLabel="Deleting"
        confirmIcon={<TrashIcon data-icon="inline-start" />}
        destructive
        pending={remove.isPending}
        error={remove.error}
        onConfirm={submitDelete}
      />
    </>
  );
}

/** Says exactly what is about to change, so the confirm is not a shrug. */
function describeChange(input: {
  creating: boolean;
  role: Role | null;
  chosen: readonly PermissionKey[];
  nameChanged: boolean;
  descriptionChanged: boolean;
  permissionsChanged: boolean;
}): string[] {
  const { creating, role, chosen } = input;
  if (creating || role === null) {
    return [`The new role will carry ${String(chosen.length)} permissions.`];
  }

  const lines: string[] = [];
  if (input.nameChanged) lines.push(`Renamed from "${role.name}".`);
  if (input.descriptionChanged) lines.push('The description changes.');

  if (input.permissionsChanged) {
    const before = new Set(role.permissions);
    const granted = chosen.filter((key) => !before.has(key));
    const revoked = role.permissions.filter((key) => !chosen.includes(key));
    if (granted.length > 0) lines.push(`Granting: ${granted.join(', ')}.`);
    if (revoked.length > 0) lines.push(`Revoking: ${revoked.join(', ')}.`);
  }

  if (role.memberCount > 0) {
    lines.push(
      `${String(role.memberCount)} active ${role.memberCount === 1 ? 'account is' : 'accounts are'} affected immediately.`,
    );
  }

  return lines;
}

/**
 * One permission, with a real checkbox.
 *
 * The read-only version of this screen showed a tick or the words "Not
 * granted", which was right while nothing could be changed. Now that something
 * can, a checkbox is the control — and it is labelled by the key itself, so the
 * whole 44px row is the hit target rather than a 16px box.
 */
function PermissionToggle({
  permissionKey,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  permissionKey: PermissionKey;
  description: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <Item size="sm" className="min-h-11 rounded-none px-0">
      <Checkbox
        id={`perm-${permissionKey}`}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next: boolean | 'indeterminate') => {
          onCheckedChange(next === true);
        }}
      />
      <ItemContent className="min-w-0 gap-0.5">
        <Label htmlFor={`perm-${permissionKey}`} className="cursor-pointer">
          <ItemTitle className="truncate font-mono text-xs">{permissionKey}</ItemTitle>
        </Label>
        <ItemDescription className="truncate text-xs">{description}</ItemDescription>
      </ItemContent>
      {disabled && checked ? <Badge variant="secondary">Granted</Badge> : null}
    </Item>
  );
}
