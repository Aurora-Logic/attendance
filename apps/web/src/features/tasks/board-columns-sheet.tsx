import { useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react';

import { Form } from '@/components/shared/form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { actionErrorCopy } from '@/features/leave/api-error-copy';
import { useIsMobile } from '@/hooks/use-mobile';

import type { BoardColumn } from './types';
import { useBoardColumns, useDeleteBoardColumn, useReorderBoardColumns, useSaveBoardColumn } from './use-tasks';

/**
 * REQ-V-03: "board columns are configuration, not code". Rename, mark as
 * closing, reorder with the arrow buttons (the whole order is sent, so two
 * quick moves cannot leave two columns claiming one slot), add, remove. The
 * server refuses the removes and flips that would leave no open column or
 * orphan tasks, and the refusal is shown where it happened.
 */
export function BoardColumnsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const isMobile = useIsMobile();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? 'bottom' : 'right'} className="gap-0 sm:max-w-md max-md:max-h-[90vh]">
        <SheetHeader className="shrink-0 border-b">
          <SheetTitle>Board columns</SheetTitle>
          <SheetDescription>
            A task&rsquo;s status is the column it sits in. Moving a task into a closing column closes it.
          </SheetDescription>
        </SheetHeader>
        {open ? <ColumnsBody /> : null}
      </SheetContent>
    </Sheet>
  );
}

function ColumnsBody() {
  const columns = useBoardColumns();
  const save = useSaveBoardColumn();
  const reorder = useReorderBoardColumns();
  const remove = useDeleteBoardColumn();
  const [newName, setNewName] = useState('');
  const list = columns.data ?? [];
  const failure = save.error ?? reorder.error ?? remove.error;
  const copy = actionErrorCopy(failure, 'Changing the board');

  function move(index: number, delta: -1 | 1) {
    const next = [...list];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    if (item === undefined) return;
    next.splice(target, 0, item);
    reorder.mutate(next.map((c) => c.id));
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <FieldGroup>
        {failure ? (
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle>{copy.title}</AlertTitle>
            <AlertDescription>{copy.description}</AlertDescription>
          </Alert>
        ) : null}

        <ul className="divide-y border">
          {list.map((column, index) => (
            <ColumnRow
              key={column.id}
              column={column}
              first={index === 0}
              last={index === list.length - 1}
              busy={save.isPending || reorder.isPending || remove.isPending}
              onRename={(name) => {
                if (name.trim() === '' || name.trim() === column.name) return;
                save.mutate({ id: column.id, name, isDone: column.isDone });
              }}
              onToggleDone={(isDone) => {
                save.mutate({ id: column.id, name: column.name, isDone });
              }}
              onUp={() => {
                move(index, -1);
              }}
              onDown={() => {
                move(index, 1);
              }}
              onRemove={() => {
                remove.mutate(column.id, {
                  onSuccess: () => {
                    toast.add({ type: 'success', title: `${column.name} removed` });
                  },
                });
              }}
            />
          ))}
        </ul>

        <Form
          onSubmit={() => {
            if (newName.trim() === '') return;
            save.mutate(
              { name: newName, isDone: false },
              {
                onSuccess: (created) => {
                  toast.add({ type: 'success', title: `${created.name} added` });
                  setNewName('');
                },
              },
            );
          }}
        >
          <Field>
            <FieldLabel htmlFor="new-column-name">New column</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="new-column-name"
                className="pointer-coarse:h-11"
                placeholder="Waiting on customer"
                value={newName}
                onChange={(event) => {
                  setNewName(event.target.value);
                }}
              />
              <Button type="submit" variant="outline" disabled={save.isPending || newName.trim() === ''}>
                {save.isPending ? <Spinner data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
                Add
              </Button>
            </div>
            <FieldDescription>Added last and open; switch &ldquo;closes&rdquo; on to make it a done column.</FieldDescription>
          </Field>
        </Form>
      </FieldGroup>
    </div>
  );
}

function ColumnRow({
  column,
  first,
  last,
  busy,
  onRename,
  onToggleDone,
  onUp,
  onDown,
  onRemove,
}: {
  column: BoardColumn;
  first: boolean;
  last: boolean;
  busy: boolean;
  onRename: (name: string) => void;
  onToggleDone: (isDone: boolean) => void;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(column.name);
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2">
      <Input
        aria-label={`Name of ${column.name}`}
        className="pointer-coarse:h-11 min-w-0 flex-1"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
        onBlur={() => {
          onRename(name);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onRename(name);
          }
        }}
      />
      <Label htmlFor={`column-done-${column.id}`} className="flex items-center gap-1.5 text-xs font-normal">
        <Switch
          id={`column-done-${column.id}`}
          checked={column.isDone}
          disabled={busy}
          onCheckedChange={(next: boolean) => {
            onToggleDone(next);
          }}
        />
        closes
      </Label>
      <span className="flex items-center">
        <Button variant="ghost" size="icon-sm" aria-label={`Move ${column.name} up`} disabled={busy || first} onClick={onUp}>
          <ArrowUpIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Move ${column.name} down`} disabled={busy || last} onClick={onDown}>
          <ArrowDownIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${column.name}`} disabled={busy} onClick={onRemove}>
          <TrashIcon />
        </Button>
      </span>
    </li>
  );
}
