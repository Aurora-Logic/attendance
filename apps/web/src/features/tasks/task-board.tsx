import { CheckCircleIcon } from '@phosphor-icons/react';

import { KanbanBoard } from '@/components/shared/kanban-board';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { TASK_PRIORITY_LABELS } from '@vyuha/shared';

import { DueDate } from './due-date';
import type { BoardResponse, Task } from './types';

/**
 * REQ-V-03: the same query as the list, in lanes; a drag moves a task
 * between them and is a PATCH like any other status change (REQ-V-06).
 */
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
      lanes={board.lanes.map(({ column, tasks, total }) => ({
        id: column.id,
        label: column.name,
        title: (
          <>
            {column.isDone ? <CheckCircleIcon className="text-muted-foreground shrink-0" /> : null}
            {column.name}
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
          <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-normal">
            {task.priority === 'HIGH' ? <Badge variant="outline">{TASK_PRIORITY_LABELS.HIGH}</Badge> : null}
            <DueDate value={task.dueDate} closed={task.isClosed} />
            {task.assigneeName === null ? null : <span>{task.assigneeName}</span>}
            {task.subjectLabel === null ? null : <span className="truncate">on {task.subjectLabel}</span>}
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
