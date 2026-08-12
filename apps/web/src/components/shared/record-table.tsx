import type { ReactNode } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface RecordColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Right-align and use tabular numerals (PRD §6.3). */
  numeric?: boolean;
  /** Hidden below 1280px per the responsive rules in PRD §6.5. */
  secondary?: boolean;
  className?: string;
}

interface RecordTableProps<T> {
  columns: RecordColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Mobile card line one: the primary identifier. */
  mobilePrimary: (row: T) => ReactNode;
  /** Mobile card line one, right side: usually a status pill. */
  mobileStatus?: (row: T) => ReactNode;
  /** Mobile card line two: two supporting fields. */
  mobileSupporting?: (row: T) => ReactNode;
  onRowActivate?: (row: T) => void;
  emptyState?: ReactNode;
}

/**
 * The one table pattern (CLAUDE.md §3 rule 4).
 *
 * PRD §6.5: below 768px a table becomes stacked record rows — primary
 * identifier plus status pill on line one, two supporting fields on line two —
 * and never a horizontal scroll of a wide table. Both renderings come from one
 * component so a screen cannot implement only half of the rule.
 *
 * The table sits directly on the page surface with a single outer border, not
 * inside a Card (PRD §6.2, no box-in-box).
 */
export function RecordTable<T>({
  columns,
  rows,
  rowKey,
  mobilePrimary,
  mobileStatus,
  mobileSupporting,
  onRowActivate,
  emptyState,
}: RecordTableProps<T>) {
  if (rows.length === 0 && emptyState) {
    return <div className="rounded-lg border">{emptyState}</div>;
  }

  return (
    <>
      {/* Desktop and tablet */}
      <div className="hidden overflow-hidden rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  className={cn(
                    column.numeric && 'text-right tabular-nums',
                    column.secondary && 'hidden xl:table-cell',
                    column.className,
                  )}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={rowKey(row)}
                className={cn(onRowActivate && 'cursor-pointer')}
                tabIndex={onRowActivate ? 0 : undefined}
                onClick={onRowActivate ? () => { onRowActivate(row); } : undefined}
                onKeyDown={
                  onRowActivate
                    ? (event) => {
                        // PRD §6.4: Enter drills into the focused row.
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          onRowActivate(row);
                        }
                      }
                    : undefined
                }
              >
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    className={cn(
                      column.numeric && 'text-right tabular-nums',
                      column.secondary && 'hidden xl:table-cell',
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Below 768px */}
      <div className="flex flex-col overflow-hidden rounded-lg border md:hidden">
        {rows.map((row) => (
          <div
            key={rowKey(row)}
            role={onRowActivate ? 'button' : undefined}
            tabIndex={onRowActivate ? 0 : undefined}
            onClick={onRowActivate ? () => { onRowActivate(row); } : undefined}
            onKeyDown={
              onRowActivate
                ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onRowActivate(row);
                    }
                  }
                : undefined
            }
            // 44px minimum touch target (CLAUDE.md §3 rule 1).
            className="flex min-h-[3.25rem] flex-col justify-center gap-1 border-b px-3 py-2 last:border-b-0"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{mobilePrimary(row)}</span>
              {mobileStatus ? mobileStatus(row) : null}
            </div>
            {mobileSupporting ? (
              <div className="text-muted-foreground truncate text-xs">
                {mobileSupporting(row)}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}
