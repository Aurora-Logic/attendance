import * as React from "react"
import { useNavigate } from "react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown } from "lucide-react"
import {
  ageingBucket,
  formatPaise,
  outstandingPaise,
  poTotals,
  type Invoice,
} from "@attendance/shared"

import { todayISO } from "@/lib/procurement"
import { useSales } from "@/lib/sales"
import { DataTable } from "@/components/data-table"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface InvoiceRow {
  invoice: Invoice
  customerName: string
  totalPaise: number
  outstanding: number
  bucket: string
}

const BUCKET_VARIANT: Record<string, "success" | "secondary" | "warning" | "destructive"> = {
  PAID: "success",
  CURRENT: "secondary",
  "1-30": "warning",
  "31-60": "warning",
  "61-90": "destructive",
  "90+": "destructive",
}

export function InvoicesPage() {
  const { invoices, customers, receipts } = useSales()
  const navigate = useNavigate()
  const today = todayISO()

  const rows = React.useMemo<InvoiceRow[]>(
    () =>
      invoices
        .map((invoice) => {
          const outstanding = outstandingPaise(invoice, receipts)
          return {
            invoice,
            customerName:
              customers.find((customer) => customer.id === invoice.customerId)?.name ?? "—",
            totalPaise: poTotals(invoice.lines).totalPaise,
            outstanding,
            bucket:
              invoice.status === "CANCELLED"
                ? "CANCELLED"
                : outstanding === 0
                  ? "PAID"
                  : ageingBucket(invoice.dueDate, today),
          }
        })
        .sort((a, b) => b.invoice.number.localeCompare(a.invoice.number)),
    [invoices, customers, receipts, today]
  )

  const columns = React.useMemo<ColumnDef<InvoiceRow>[]>(
    () => [
      {
        id: "number",
        accessorFn: (row) => row.invoice.number,
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Invoice
            <ArrowUpDown />
          </Button>
        ),
        meta: { label: "Invoice number" },
        cell: ({ row }) => <span className="font-medium">{row.original.invoice.number}</span>,
      },
      { id: "customerName", accessorFn: (row) => row.customerName, header: "Customer" },
      { id: "date", accessorFn: (row) => row.invoice.date, header: "Date" },
      { id: "dueDate", accessorFn: (row) => row.invoice.dueDate, header: "Due" },
      {
        id: "total",
        accessorFn: (row) => row.totalPaise,
        header: "Total",
        cell: ({ row }) => <span className="tabular-nums">{formatPaise(row.original.totalPaise)}</span>,
      },
      {
        id: "outstanding",
        accessorFn: (row) => row.outstanding,
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Outstanding
            <ArrowUpDown />
          </Button>
        ),
        meta: { label: "Outstanding" },
        cell: ({ row }) => (
          <span className="font-medium tabular-nums">
            {row.original.outstanding ? formatPaise(row.original.outstanding) : "—"}
          </span>
        ),
      },
      {
        id: "bucket",
        accessorFn: (row) => row.bucket,
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={BUCKET_VARIANT[row.original.bucket] ?? "outline"}>
            {row.original.bucket === "CURRENT" ? "Current" : row.original.bucket}
          </Badge>
        ),
      },
    ],
    []
  )

  return (
    <Page>
      <PageHeader
        title="Invoices"
        description="Raised from sales orders — billing never reprices. Money lands on the Receivables screen."
      />
      <PageBodyFixed>
        <DataTable
          columns={columns}
          data={rows}
          searchColumn="customerName"
          searchPlaceholder="Search customer…"
          emptyTitle="No invoices yet"
          emptyDescription="Open a sales order and use Create invoice."
          onRowClick={(row) => navigate(`/invoices/${row.invoice.id}`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{row.invoice.number}</span>
                <Badge variant={BUCKET_VARIANT[row.bucket] ?? "outline"}>
                  {row.bucket === "CURRENT" ? "Current" : row.bucket}
                </Badge>
              </div>
              <span className="text-muted-foreground text-xs">
                {row.customerName} · due {row.invoice.dueDate}
              </span>
              <span className="text-sm font-medium tabular-nums">
                {row.outstanding ? `${formatPaise(row.outstanding)} due` : formatPaise(row.totalPaise)}
              </span>
            </div>
          )}
        />
      </PageBodyFixed>
    </Page>
  )
}
