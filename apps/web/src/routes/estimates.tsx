import * as React from "react"
import { useNavigate } from "react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, Pencil, Plus } from "lucide-react"
import {
  estimateDisplayStatus,
  formatPaise,
  poTotals,
  type Estimate,
  type EstimateDisplayStatus,
} from "@attendance/shared"

import { todayISO } from "@/lib/procurement"
import { useSales } from "@/lib/sales"
import { useSession } from "@/lib/session"
import { DataTable } from "@/components/data-table"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import { ESTIMATE_STATUS_LABEL, EstimateStatusBadge } from "@/components/po-status-badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface EstimateRow {
  estimate: Estimate
  customerName: string
  displayStatus: EstimateDisplayStatus
  totalPaise: number
}

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "ALL", label: "All statuses" },
  ...Object.entries(ESTIMATE_STATUS_LABEL).map(([value, label]) => ({ value, label })),
]

export function EstimatesPage() {
  const { estimates, customers } = useSales()
  const { can } = useSession()
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = React.useState("ALL")
  const today = todayISO()

  const rows = React.useMemo<EstimateRow[]>(
    () =>
      estimates
        .map((estimate) => ({
          estimate,
          customerName:
            customers.find((customer) => customer.id === estimate.customerId)?.name ?? "—",
          displayStatus: estimateDisplayStatus(estimate, today),
          totalPaise: poTotals(estimate.lines).totalPaise,
        }))
        .filter((row) => statusFilter === "ALL" || row.displayStatus === statusFilter)
        .sort((a, b) => b.estimate.number.localeCompare(a.estimate.number)),
    [estimates, customers, statusFilter, today]
  )

  const columns = React.useMemo<ColumnDef<EstimateRow>[]>(
    () => [
      {
        id: "number",
        accessorFn: (row) => row.estimate.number,
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Estimate
            <ArrowUpDown />
          </Button>
        ),
        meta: { label: "Estimate number" },
        cell: ({ row }) => <span className="font-medium">{row.original.estimate.number}</span>,
      },
      {
        id: "customerName",
        accessorFn: (row) => row.customerName,
        header: "Customer",
        meta: { label: "Customer" },
      },
      {
        id: "date",
        accessorFn: (row) => row.estimate.date,
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Date
            <ArrowUpDown />
          </Button>
        ),
        meta: { label: "Date" },
      },
      {
        id: "validUntil",
        accessorFn: (row) => row.estimate.validUntil ?? "",
        header: "Valid until",
        meta: { label: "Valid until" },
        cell: ({ row }) => row.original.estimate.validUntil ?? "—",
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
        accessorFn: (row) => row.displayStatus,
        header: "Status",
        cell: ({ row }) => <EstimateStatusBadge status={row.original.displayStatus} />,
      },
      {
        id: "rowActions",
        header: "",
        cell: ({ row }) =>
          row.original.estimate.status === "DRAFT" && can("sales.manage") ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Edit ${row.original.estimate.number}`}
              onClick={() =>
                navigate("/estimates/new", { state: { editEstimateId: row.original.estimate.id } })
              }
            >
              <Pencil />
            </Button>
          ) : null,
      },
    ],
    [can, navigate]
  )

  return (
    <Page>
      <PageHeader
        title="Estimates"
        description="Quote, send, and record the customer's answer; accepted estimates become sales orders next."
        actions={
          can("sales.manage") ? (
            <Button size="sm" onClick={() => navigate("/estimates/new")}>
              <Plus />
              New estimate
            </Button>
          ) : null
        }
      />
      <PageBodyFixed>
        <DataTable
          columns={columns}
          data={rows}
          searchColumn="customerName"
          searchPlaceholder="Search customer…"
          emptyTitle="No estimates yet"
          emptyDescription="Raise the first estimate from the New estimate button."
          onRowClick={(row) => navigate(`/estimates/${row.estimate.id}`)}
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
                <span className="font-medium">{row.estimate.number}</span>
                <EstimateStatusBadge status={row.displayStatus} />
              </div>
              <span className="text-muted-foreground text-xs">
                {row.customerName} · {row.estimate.date}
                {row.estimate.validUntil ? ` · valid till ${row.estimate.validUntil}` : ""}
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
