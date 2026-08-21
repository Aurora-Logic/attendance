import { CheckCircleIcon, CircleDashedIcon, LinkSimpleIcon, UserCircleIcon } from '@phosphor-icons/react';

import { KanbanBoard } from '@/components/shared/kanban-board';
import { cn } from '@/lib/utils';
import { TASK_PRIORITY_LABELS } from '@vyuha/shared';

import { DueDate } from './due-date';
import type { BoardResponse, Task } from './types';

/**
 * REQ-V-03: the same query as the list, in lanes; a drag moves a task
 * between them and is a PATCH like any other status change (REQ-V-06).
 * The lanes wear the deal board's dress: a tint per column, cycled by
 * position, in the header chip; the done column is always green.
 */

const COLUMN_HUES = [
  'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
] as const;
const DONE_HUE = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
const PRIORITY_CHIP = 'rounded bg-rose-100 px-1 py-px text-[0.6875rem] font-medium text-rose-700 dark:bg-rose-500/15 dark:text-rose-300';
export function TaskBoard({
  board,
  onOpen,
  onMove,
  moving,
}: {
  board: BoardResponse;
  onOpen: (task: Task) => void;
  onMove: (task: Task, columnId: string) => void;
  moving: boolean;
}) {
  return (
    <KanbanBoard
      ariaLabel="Task board"
      lanes={board.lanes.map(({ column, tasks, total }, index) => ({
        id: column.id,
        label: column.name,
        accent: column.isDone ? DONE_HUE : (COLUMN_HUES[index % COLUMN_HUES.length] ?? COLUMN_HUES[0]),
        title: (
          <>
            {column.isDone ? <CheckCircleIcon className="shrink-0" /> : <CircleDashedIcon className="shrink-0" />}
            <span className="truncate">{column.name}</span>
          </>
        ),
        items: tasks,
        total,
        muted: column.isDone,
      }))}
      itemKey={(task) => task.id}
      itemLaneId={(task) => task.columnId}
      itemLabel={(task) => task.title}
      renderItem={(task) => (
        <>
          <span className={cn('font-medium', task.isClosed && 'text-muted-foreground line-through')}>{task.title}</span>
          <span className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs font-normal">
            {task.priority === 'HIGH' ? <span className={PRIORITY_CHIP}>{TASK_PRIORITY_LABELS.HIGH}</span> : null}
            <DueDate value={task.dueDate} closed={task.isClosed} />
            {task.assigneeName === null ? null : (
              <span className="flex min-w-0 items-center gap-1">
                <UserCircleIcon className="shrink-0" />
                <span className="truncate">{task.assigneeName}</span>
              </span>
            )}
            {task.subjectLabel === null ? null : (
              <span className="flex min-w-0 items-center gap-1">
                <LinkSimpleIcon className="shrink-0" />
                <span className="truncate">{task.subjectLabel}</span>
              </span>
            )}
          </span>
        </>
      )}
      onOpen={onOpen}
      onMove={(task, laneId) => {
        onMove(task, laneId);
      }}
      moving={moving}
    />
  );
}
