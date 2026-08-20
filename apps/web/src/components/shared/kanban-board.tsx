import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

/**
 * Lanes of cards with drag-between-lanes (REQ-V-03 for tasks, the deal
 * pipeline for CRM). One composition for both so the drag behaviour, the
 * empty lane, the "and N more" line and the keyboard path exist once.
 *
 * Native drag and drop rather than a library (CLAUDE.md §6: no dependency
 * without asking), and no ambition beyond "drop on a lane" — ordering within
 * a lane is the sort the query already applies. A card is a shadcn Button,
 * so opening one never needs a mouse; moving without one is the list view's
 * promise, kept there (REQ-V-05).
 */

export interface KanbanLane<T> {
  readonly id: string;
  /** The lane's accessible name; `title` may dress it with an icon. */
  readonly label: string;
  readonly title: ReactNode;
  /** Right-aligned in the header: a count, a total. */
  readonly meta?: ReactNode;
  readonly items: readonly T[];
  /** Beyond `items` when the lane was capped. */
  readonly total: number;
  readonly muted?: boolean;
}

interface KanbanBoardProps<T> {
  lanes: readonly KanbanLane<T>[];
  itemKey: (item: T) => string;
  itemLaneId: (item: T) => string;
  itemLabel: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  onOpen: (item: T) => void;
  onMove: (item: T, laneId: string) => void;
  moving: boolean;
  ariaLabel: string;
  /** Where the list rendering lives, for the "and N more" line. */
  overflowHint?: string;
}

export function KanbanBoard<T>({
  lanes,
  itemKey,
  itemLaneId,
  itemLabel,
  renderItem,
  onOpen,
  onMove,
  moving,
  ariaLabel,
  overflowHint = 'see the list',
}: KanbanBoardProps<T>) {
  const [dragging, setDragging] = useState<T | null>(null);
  const [over, setOver] = useState<string | null>(null);

  return (
    <ScrollArea className="w-full">
      <div className="flex min-w-max gap-3 pb-3" role="list" aria-label={ariaLabel}>
        {lanes.map((lane) => (
          <section
            key={lane.id}
            role="listitem"
            aria-label={`${lane.label}, ${String(lane.total)} item${lane.total === 1 ? '' : 's'}`}
            className={cn(
              'flex w-72 shrink-0 flex-col border',
              lane.muted && 'bg-muted/30',
              over === lane.id && dragging !== null && itemLaneId(dragging) !== lane.id && 'bg-accent/40',
            )}
            onDragOver={(event) => {
              if (dragging === null) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              if (over !== lane.id) setOver(lane.id);
            }}
            onDragLeave={() => {
              if (over === lane.id) setOver(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragging !== null && itemLaneId(dragging) !== lane.id && !moving) onMove(dragging, lane.id);
              setDragging(null);
              setOver(null);
            }}
          >
            <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-medium">{lane.title}</span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{lane.meta ?? lane.total}</span>
            </header>
            <div className="flex min-h-24 flex-col gap-2 p-2">
              {lane.items.length === 0 ? (
                <p className="text-muted-foreground px-1 py-3 text-center text-xs">Nothing here</p>
              ) : null}
              {lane.items.map((item) => (
                <div
                  key={itemKey(item)}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', itemKey(item));
                    setDragging(item);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  className={cn('bg-background border', dragging !== null && itemKey(dragging) === itemKey(item) && 'opacity-50')}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      onOpen(item);
                    }}
                    className="h-auto w-full flex-col items-start gap-1 rounded-none px-3 py-2 text-left whitespace-normal"
                    aria-label={`Open ${itemLabel(item)}`}
                  >
                    {renderItem(item)}
                  </Button>
                </div>
              ))}
              {lane.total > lane.items.length ? (
                <p className="text-muted-foreground px-1 py-1 text-center text-xs">
                  and {lane.total - lane.items.length} more — {overflowHint}
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
