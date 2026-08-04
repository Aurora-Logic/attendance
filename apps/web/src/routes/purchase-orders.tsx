import * as React from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import type { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, FileDown, Plus } from "lucide-react"
import {
  formatPaise,
  poDisplayStatus,
  poTotals,
  receiptProgress,
  type PoDisplayStatus,
  type PurchaseOrder,
} from "@attendance/shared"

import { useProcurement } from "@/lib/procurement"
import { useSession } from "@/lib/session"
import { exportPoRegisterExcel } from "@/lib/po-export"
import { DataTable } from "@/components/data-table"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import { PO_STATUS_LABEL, PoStatusBadge } from "@/components/po-status-badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface PoRow {
  po: PurchaseOrder
  vendorName: string
  displayStatus: PoDisplayStatus
  totalPaise: number
  receiptPct: number
}

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "ALL", label: "All statuses" },
  ...Object.entries(PO_STATUS_LABEL).map(([value, label]) => ({ value, label })),
]

export function PurchaseOrdersPage() {
  const { pos, grns, vendors, items } = useProcurement()
  const { can } = useSession()
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = React.useState("ALL")

  const rows = React.useMemo<PoRow[]>(
    () =>
      pos
        .map((po) => {
          const progress = receiptProgress(po, grns)
          const ordered = progress.reduce((sum, line) => sum + line.orderedQty, 0)
          const accepted = progress.reduce(
            (sum, line) => sum + Math.min(line.acceptedQty, line.orderedQty),
            0
          )
          return {
            po,
            vendorName: vendors.find((vendor) => vendor.id === po.vendorId)?.name ?? "—",
            displayStatus: poDisplayStatus(po, grns),
            totalPaise: poTotals(po.lines).totalPaise,
            receiptPct: ordered ? Math.round((accepted / ordered) * 100) : 0,
          }
        })
        .filter((row) => statusFilter === "ALL" || row.displayStatus === statusFilter)
        .sort((a, b) => b.po.number.localeCompare(a.po.number)),
    [pos, grns, vendors, statusFilter]
  )

  const columns = React.useMemo<ColumnDef<PoRow>[]>(
    () => [
      {
        id: "number",
        accessorFn: (row) => row.po.number,
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            PO number
            <ArrowUpDown />
          </Button>
        ),
        meta: { label: "PO number" },
        cell: ({ row }) => <span className="font-medium">{row.original.po.number}</span>,
      },
      {
        id: "vendorName",
        accessorFn: (row) => row.vendorName,
        header: "Vendor",
        meta: { label: "Vendor" },
      },
      {
        id: "orderDate",
        accessorFn: (row) => row.po.orderDate,
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
        meta: { label: "Order date" },
      },
      {
        id: "lines",
        header: "Lines",
        cell: ({ row }) => row.original.po.lines.length,
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
        id: "received",
        header: "Received",
        meta: { label: "Received" },
        cell: ({ row }) =>
          row.original.po.status === "APPROVED" || row.original.po.status === "CLOSED" ? (
            <div className="flex items-center gap-2">
              <Progress value={row.original.receiptPct} className="w-20" />
              <span className="text-muted-foreground text-xs tabular-nums">
                {row.original.receiptPct}%
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "status",
        accessorFn: (row) => row.displayStatus,
        header: "Status",
        cell: ({ row }) => <PoStatusBadge status={row.original.displayStatus} />,
      },
    ],
    []
  )

  const onExport = async () => {
    await exportPoRegisterExcel(
      rows.map((row) => ({
        po: row.po,
        vendorName: row.vendorName,
        displayStatus: row.displayStatus,
        receiptPct: row.receiptPct,
      })),
      items
    )
    toast.success("PO register exported", { description: `${rows.length} orders → Excel` })
  }

  return (
    <Page>
      <PageHeader
        title="Purchase Orders"
        description="Raise, approve and receive against orders; export the register or a single PO."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={onExport} disabled={rows.length === 0}>
              <FileDown />
              Export Excel
            </Button>
            {can("procurement.manage") ? (
              <Button size="sm" onClick={() => navigate("/purchase-orders/new")}>
                <Plus />
                New PO
              </Button>
            ) : null}
          </>
        }
      />
      <PageBodyFixed>
        <DataTable
          columns={columns}
          data={rows}
          searchColumn="vendorName"
          searchPlaceholder="Search vendor…"
          emptyTitle="No purchase orders"
          emptyDescription="Raise the first PO from the New PO button."
          onRowClick={(row) => navigate(`/purchase-orders/${row.po.id}`)}
          toolbar={
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger size="sm" className="w-44">
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
        />
      </PageBodyFixed>
    </Page>
  )
}
