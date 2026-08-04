import * as React from "react"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  type Table as TanstackTable,
} from "@tanstack/react-table"
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * Human label for the columns menu.
 *
 * A column's id is its accessor key, so it reads `firstInAt` / `workedMinutes`
 * unless the column supplies `meta.label`. Falling back to a de-camel-cased id
 * means a new column is legible without anyone remembering to add meta.
 */
function columnLabel(column: { id: string; columnDef: { meta?: unknown } }): string {
  const meta = column.columnDef.meta as { label?: string } | undefined
  if (meta?.label) return meta.label
  return column.id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase())
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  /** Column id the toolbar search box filters on. */
  searchColumn?: string
  searchPlaceholder?: string
  isLoading?: boolean
  emptyTitle?: string
  emptyDescription?: string
  /** Extra toolbar controls (date range, branch/department filters). */
  toolbar?: React.ReactNode
  /** Rendered when rows are selected — bulk approve, export selection, etc. */
  selectionActions?: (table: TanstackTable<TData>) => React.ReactNode
  pageSize?: number
  /** Fill the parent's height and scroll the tbody instead of the page. */
  fill?: boolean
  /** Makes rows navigable. Clicks on controls inside a row are ignored. */
  onRowClick?: (row: TData) => void
  /**
   * Phone rendering: below `sm` the table becomes a card list, one card per
   * row, rendered by this function. Sorting, search, filters and pagination
   * keep working — only the row presentation changes. Opt-in per screen.
   */
  renderMobileCard?: (row: TData) => React.ReactNode
}

/**
 * The single table for every report surface in the app. Built on TanStack Table
 * v8 following the shadcn `data-table-demo` composition — there is no
 * `data-table` component in the registry to install.
 *
 * In `fill` mode the toolbar and pager stay put and only the rows scroll, so the
 * page itself never grows past the viewport.
 *
 * Sizing is deliberately untouched: `size="sm"` on toolbar controls only, and
 * default everywhere else.
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  searchColumn,
  searchPlaceholder = "Search…",
  isLoading = false,
  emptyTitle = "No results",
  emptyDescription = "Try widening the date range or clearing a filter.",
  toolbar,
  selectionActions,
  pageSize = 25,
  fill = true,
  onRowClick,
  renderMobileCard,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = React.useState({})

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    initialState: { pagination: { pageSize } },
    state: { sorting, columnFilters, columnVisibility, rowSelection },
  })

  const selectedCount = table.getFilteredSelectedRowModel().rows.length
  const totalCount = table.getFilteredRowModel().rows.length

  return (
    <div className={cn("flex flex-col gap-4", fill && "min-h-0 flex-1")}>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {searchColumn ? (
          <InputGroup className="w-full sm:max-w-xs">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              placeholder={searchPlaceholder}
              value={(table.getColumn(searchColumn)?.getFilterValue() as string) ?? ""}
              onChange={(event) =>
                table.getColumn(searchColumn)?.setFilterValue(event.target.value)
              }
            />
          </InputGroup>
        ) : null}
        {toolbar}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="ml-auto">
              <SlidersHorizontal />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) => column.toggleVisibility(!!value)}
                >
                  {columnLabel(column)}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {selectionActions && selectedCount > 0 ? (
        <div className="bg-muted/50 flex shrink-0 flex-wrap items-center gap-2 rounded-md border px-3 py-2">
          <span className="text-sm font-medium">{selectedCount} selected</span>
          <div className="ml-auto flex items-center gap-2">{selectionActions(table)}</div>
        </div>
      ) : null}

      {renderMobileCard ? (
        <div className={cn("flex flex-col gap-2 overflow-y-auto sm:hidden", fill && "min-h-0 flex-1")}>
          {isLoading ? (
            Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-20 w-full rounded-md" />
            ))
          ) : table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <div
                key={row.id}
                className={cn("rounded-md border p-3", onRowClick && "active:bg-muted/50")}
                onClick={
                  onRowClick
                    ? (event) => {
                        if ((event.target as HTMLElement).closest("button,a,input,[role=checkbox]"))
                          return
                        onRowClick(row.original)
                      }
                    : undefined
                }
              >
                {renderMobileCard(row.original)}
              </div>
            ))
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{emptyTitle}</EmptyTitle>
                <EmptyDescription>{emptyDescription}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      ) : null}

      <div
        className={cn(
          "overflow-auto rounded-md border",
          fill ? "min-h-0 flex-1" : "max-h-[70svh]",
          renderMobileCard && "max-sm:hidden"
        )}
      >
        <Table>
          <TableHeader className="bg-muted sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="whitespace-nowrap">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 10 }).map((_, rowIndex) => (
                <TableRow key={rowIndex}>
                  {columns.map((_column, cellIndex) => (
                    <TableCell key={cellIndex}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className={onRowClick ? "cursor-pointer" : undefined}
                  onClick={
                    onRowClick
                      ? (event) => {
                          // Don't navigate when the click was aimed at a
                          // checkbox, button or link inside the row.
                          if ((event.target as HTMLElement).closest("button,a,input,[role=checkbox]"))
                            return
                          onRowClick(row.original)
                        }
                      : undefined
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="h-48">
                  <Empty className="border-0">
                    <EmptyHeader>
                      <EmptyTitle>{emptyTitle}</EmptyTitle>
                      <EmptyDescription>{emptyDescription}</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {selectedCount > 0
            ? `${selectedCount} of ${totalCount} row(s) selected`
            : `${totalCount} row(s)`}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  )
}
