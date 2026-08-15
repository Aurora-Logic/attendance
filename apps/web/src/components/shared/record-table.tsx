import { Fragment, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@/components/ui/item';

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
    return <div className="border">{emptyState}</div>;
  }

  return (
    <>
      {/* Desktop and tablet */}
      {/* Both branches carry an anchor and both are always in the DOM — only
          CSS decides which is visible. The guide picks between them by width,
          the same way it chooses the sidebar or the bottom bar. */}
      <div data-guide="screen.table" className="hidden overflow-x-auto border md:block">
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

      {/* Below 768px. Built from shadcn's Item rather than hand-rolled row
          markup — the registry already models exactly this shape, and a
          bespoke version would drift from it the first time the theme moves
          (CLAUDE.md §3 rule 1). */}
      {/* role="presentation" overrides ItemGroup's built-in role="list". A list
          whose children are all role="button" has no listitem in it, so a
          screen reader announces an empty list — worse than the plain container
          this replaced. The rows carry the semantics; the group is visual.

          gap-0 because ItemGroup spaces its children by default, which left the
          separators floating in 10px of nothing instead of dividing flush rows. */}
      <ItemGroup
        role="presentation"
        data-guide="screen.table-cards"
        className="gap-0 border md:hidden"
      >
        {rows.map((row, index) => (
          <Fragment key={rowKey(row)}>
            {index > 0 ? <ItemSeparator className="my-0" /> : null}
            <Item
              size="sm"
              role={onRowActivate ? 'button' : undefined}
              tabIndex={onRowActivate ? 0 : undefined}
              onClick={onRowActivate ? () => { onRowActivate(row); } : undefined}
              onKeyDown={
                onRowActivate
                  ? (event: ReactKeyboardEvent<HTMLDivElement>) => {
                      // PRD §6.4: Enter drills into the focused row. Space is
                      // included because the row advertises role="button", and
                      // a control that claims that role has to honour both.
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onRowActivate(row);
                      }
                    }
                  : undefined
              }
              className={cn('min-h-11 rounded-none', onRowActivate && 'cursor-pointer')}
            >
              <ItemContent className="min-w-0 gap-0.5">
                <ItemTitle className="truncate">{mobilePrimary(row)}</ItemTitle>
                {mobileSupporting ? (
                  <ItemDescription className="truncate text-xs">
                    {mobileSupporting(row)}
                  </ItemDescription>
                ) : null}
              </ItemContent>
              {mobileStatus ? <ItemActions>{mobileStatus(row)}</ItemActions> : null}
            </Item>
          </Fragment>
        ))}
      </ItemGroup>
    </>
  );
}
