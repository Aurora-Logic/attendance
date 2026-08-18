import { useState } from 'react';
import { CheckCircleIcon } from '@phosphor-icons/react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { TASK_PRIORITY_LABELS } from '@vyuha/shared';

import { DueDate } from './due-date';
import type { BoardResponse, Task } from './types';

/**
 * REQ-V-03: the same query as the list, in lanes; a drag moves a task
 * between them and is a PATCH like any other status change (REQ-V-06).
 *
 * Native drag and drop rather than a library (CLAUDE.md §6: no dependency
 * without asking), and no ambition beyond "drop on a lane" — ordering within
 * a lane is the sort the query already applies. A card is a button too, so
 * the board is not mouse-only for opening; moving without a mouse is the
 * list's promise (REQ-V-05), kept there.
 */

interface TaskBoardProps {
  board: BoardResponse;
  onOpen: (task: Task) => void;
  onMove: (task: Task, columnId: string) => void;
  moving: boolean;
}

export function TaskBoard({ board, onOpen, onMove, moving }: TaskBoardProps) {
  const [dragging, setDragging] = useState<Task | null>(null);
  const [over, setOver] = useState<string | null>(null);

  return (
    <ScrollArea className="w-full">
      <div className="flex min-w-max gap-3 pb-3" role="list" aria-label="Task board">
        {board.lanes.map(({ column, tasks, total }) => (
          <section
            key={column.id}
            role="listitem"
            aria-label={`${column.name}, ${String(total)} task${total === 1 ? '' : 's'}`}
            className={cn(
              'flex w-72 shrink-0 flex-col border',
              over === column.id && dragging !== null && dragging.columnId !== column.id && 'bg-accent/40',
            )}
            onDragOver={(event) => {
              if (dragging === null) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              if (over !== column.id) setOver(column.id);
            }}
            onDragLeave={() => {
              if (over === column.id) setOver(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragging !== null && dragging.columnId !== column.id && !moving) onMove(dragging, column.id);
              setDragging(null);
              setOver(null);
            }}
          >
            <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                {column.isDone ? <CheckCircleIcon className="text-muted-foreground" /> : null}
                {column.name}
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">{total}</span>
            </header>
            <div className="flex min-h-24 flex-col gap-2 p-2">
              {tasks.length === 0 ? (
                <p className="text-muted-foreground px-1 py-3 text-center text-xs">Nothing here</p>
              ) : null}
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  dragging={dragging?.id === task.id}
                  onOpen={() => {
                    onOpen(task);
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', task.id);
                    setDragging(task);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                />
              ))}
              {total > tasks.length ? (
                <p className="text-muted-foreground px-1 py-1 text-center text-xs">
                  and {total - tasks.length} more — see the list
                </p>
              ) : null}
            </div>
          </section>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

function TaskCard({
  task,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn('bg-background border', dragging && 'opacity-50')}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={onOpen}
        className="h-auto w-full flex-col items-start gap-1 rounded-none px-3 py-2 text-left whitespace-normal"
        aria-label={`Open ${task.title}`}
      >
        <span className={cn('font-medium', task.isClosed && 'text-muted-foreground line-through')}>{task.title}</span>
        <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-normal">
          {task.priority === 'HIGH' ? <Badge variant="outline">{TASK_PRIORITY_LABELS.HIGH}</Badge> : null}
          <DueDate value={task.dueDate} closed={task.isClosed} />
          {task.assigneeName === null ? null : <span>{task.assigneeName}</span>}
          {task.subjectLabel === null ? null : <span className="truncate">on {task.subjectLabel}</span>}
        </span>
      </Button>
    </div>
  );
}
