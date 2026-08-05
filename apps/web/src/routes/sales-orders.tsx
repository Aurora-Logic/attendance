import * as React from "react"
import { useNavigate } from "react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown } from "lucide-react"
import { formatPaise, poTotals, type SalesOrder } from "@attendance/shared"

import { useSales } from "@/lib/sales"
import { DataTable } from "@/components/data-table"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import { SO_STATUS_LABEL, SoStatusBadge } from "@/components/po-status-badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface SoRow {
  so: SalesOrder
  customerName: string
  totalPaise: number
}

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "ALL", label: "All statuses" },
  ...Object.entries(SO_STATUS_LABEL).map(([value, label]) => ({ value, label })),
]

export function SalesOrdersPage() {
  const { salesOrders, customers } = useSales()
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = React.useState("ALL")

  const rows = React.useMemo<SoRow[]>(
    () =>
      salesOrders
        .map((so) => ({
          so,
          customerName: customers.find((customer) => customer.id === so.customerId)?.name ?? "—",
          totalPaise: poTotals(so.lines).totalPaise,
        }))
        .filter((row) => statusFilter === "ALL" || row.so.status === statusFilter)
        .sort((a, b) => b.so.number.localeCompare(a.so.number)),
    [salesOrders, customers, statusFilter]
  )

  const columns = React.useMemo<ColumnDef<SoRow>[]>(
    () => [
      {
        id: "number",
        accessorFn: (row) => row.so.number,
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Order
            <ArrowUpDown />
          </Button>
        ),
        meta: { label: "Order number" },
        cell: ({ row }) => <span className="font-medium">{row.original.so.number}</span>,
      },
      {
        id: "customerName",
        accessorFn: (row) => row.customerName,
        header: "Customer",
        meta: { label: "Customer" },
      },
      {
        id: "orderDate",
        accessorFn: (row) => row.so.orderDate,
        header: "Date",
        meta: { label: "Order date" },
      },
      {
        id: "customerRef",
        accessorFn: (row) => row.so.customerRef,
        header: "Customer ref",
        meta: { label: "Customer reference" },
        cell: ({ row }) => row.original.so.customerRef || "—",
      },
      {
        id: "total",
        accessorFn: (row) => row.totalPaise,
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Total
            <ArrowUpDown />
          </Button>
        ),
        meta: { label: "Total" },
        cell: ({ row }) => (
          <span className="tabular-nums">{formatPaise(row.original.totalPaise)}</span>
        ),
      },
      {
        id: "status",
        accessorFn: (row) => row.so.status,
        header: "Status",
        cell: ({ row }) => <SoStatusBadge status={row.original.so.status} />,
      },
    ],
    []
  )

  return (
    <Page>
      <PageHeader
        title="Sales Orders"
        description="Confirmed customer commitments — born from accepted estimates. Dispatch tracking lands with inventory."
      />
      <PageBodyFixed>
        <DataTable
          columns={columns}
          data={rows}
          searchColumn="customerName"
          searchPlaceholder="Search customer…"
          emptyTitle="No sales orders yet"
          emptyDescription="Accept an estimate, then convert it — the order inherits its lines and terms."
          onRowClick={(row) => navigate(`/sales-orders/${row.so.id}`)}
          toolbar={
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((filter) => (
                  <SelectItem key={filter.value} value={filter.value}>
                    {filter.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{row.so.number}</span>
                <SoStatusBadge status={row.so.status} />
              </div>
              <span className="text-muted-foreground text-xs">
                {row.customerName} · {row.so.orderDate}
                {row.so.customerRef ? ` · ref ${row.so.customerRef}` : ""}
              </span>
              <span className="text-sm font-medium tabular-nums">
                {formatPaise(row.totalPaise)}
              </span>
            </div>
          )}
        />
      </PageBodyFixed>
    </Page>
  )
}
