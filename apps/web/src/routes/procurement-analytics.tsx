import * as React from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import type { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, CircleAlert, IndianRupee, PackageOpen, Timer } from "lucide-react"
import {
  formatPaise,
  monthlySpend,
  paiseToRupees,
  scheduleProgress,
  vendorPerformance,
  type VendorPerformance,
} from "@attendance/shared"

import { todayISO, useProcurement } from "@/lib/procurement"
import { DataTable } from "@/components/data-table"
import { Page, PageBody, PageHeader } from "@/components/page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

/**
 * The "how do our vendors actually behave" screen. Every number comes from
 * the shared projections over POs + GRNs — the same functions the API serves —
 * so a figure here can always be traced to specific receipts.
 */

const spendConfig = {
  spend: { label: "Committed spend", color: "var(--chart-1)" },
} satisfies ChartConfig

type VendorRow = VendorPerformance & { vendorName: string; vendorCode: string }

export function ProcurementAnalyticsPage() {
  const { vendors, pos, grns } = useProcurement()
  const today = todayISO()

  const rows = React.useMemo<VendorRow[]>(
    () =>
      vendors.map((vendor) => ({
        ...vendorPerformance(vendor.id, pos, grns, today),
        vendorName: vendor.name,
        vendorCode: vendor.code,
      })),
    [vendors, pos, grns, today]
  )

  const spend = React.useMemo(
    () =>
      monthlySpend(pos).map((entry) => ({
        month: entry.month,
        spend: paiseToRupees(entry.spendPaise),
      })),
    [pos]
  )

  const overdue = React.useMemo(
    () =>
      pos
        .filter((po) => po.status === "APPROVED")
        .flatMap((po) =>
          scheduleProgress(po, grns, today)
            .filter((tranche) => tranche.status === "OVERDUE")
            .map((tranche) => ({
              poNumber: po.number,
              vendorName: vendors.find((vendor) => vendor.id === po.vendorId)?.name ?? "—",
              dueDate: tranche.schedule.dueDate,
              qty: tranche.schedule.qty,
              allocatedQty: tranche.allocatedQty,
            }))
        )
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [pos, grns, vendors, today]
  )

  const openPoCount = rows.reduce((sum, row) => sum + row.openPoCount, 0)
  const totalSpend = rows.reduce((sum, row) => sum + row.totalSpendPaise, 0)
  const leadTimes = rows.filter((row) => row.avgLeadDays !== null)
  const avgLead = leadTimes.length
    ? Math.round(
        (leadTimes.reduce((sum, row) => sum + (row.avgLeadDays ?? 0), 0) / leadTimes.length) * 10
      ) / 10
    : null

  const columns = React.useMemo<ColumnDef<VendorRow>[]>(
    () => [
      {
        accessorKey: "vendorName",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Vendor
            <ArrowUpDown />
          </Button>
        ),
        meta: { label: "Vendor" },
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.vendorName}</span>
            <span className="text-muted-foreground text-xs">{row.original.vendorCode}</span>
          </div>
        ),
      },
      {
        accessorKey: "poCount",
        header: "POs",
        cell: ({ row }) => row.original.poCount,
      },
      {
        accessorKey: "totalSpendPaise",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Spend
            <ArrowUpDown />
          </Button>
        ),
        meta: { label: "Committed spend" },
        cell: ({ row }) => (
          <span className="tabular-nums">{formatPaise(row.original.totalSpendPaise)}</span>
        ),
      },
      {
        accessorKey: "avgLeadDays",
        header: "Avg lead",
        meta: { label: "Average lead time" },
        cell: ({ row }) =>
          row.original.avgLeadDays === null ? "—" : `${row.original.avgLeadDays} d`,
      },
      {
        accessorKey: "onTimeRate",
        header: "On-time",
        meta: { label: "On-time delivery" },
        cell: ({ row }) => {
          const rate = row.original.onTimeRate
          if (rate === null) return "—"
          return (
            <Badge variant={rate >= 80 ? "success" : rate >= 50 ? "warning" : "destructive"}>
              {rate}%
            </Badge>
          )
        },
      },
      {
        accessorKey: "fillRate",
        header: "Fill rate",
        meta: { label: "Fill rate" },
        cell: ({ row }) =>
          row.original.fillRate === null ? "—" : `${row.original.fillRate}%`,
      },
      {
        accessorKey: "openPoCount",
        header: "Open POs",
        meta: { label: "Open POs" },
      },
      {
        accessorKey: "overdueTrancheCount",
        header: "Overdue",
        meta: { label: "Overdue tranches" },
        cell: ({ row }) =>
          row.original.overdueTrancheCount > 0 ? (
            <Badge variant="destructive">{row.original.overdueTrancheCount}</Badge>
          ) : (
            <span className="text-muted-foreground">0</span>
          ),
      },
    ],
    []
  )

  return (
    <Page>
      <PageHeader
        title="Procurement Analytics"
        description="Lead times, on-time delivery and fill rate — projected from POs and goods receipts."
      />
      <PageBody>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={<PackageOpen className="text-muted-foreground size-4" />}
            label="Open POs"
            value={String(openPoCount)}
            hint="Approved, awaiting material"
          />
          <StatCard
            icon={<IndianRupee className="text-muted-foreground size-4" />}
            label="Committed spend"
            value={formatPaise(totalSpend)}
            hint="All approved & closed POs"
          />
          <StatCard
            icon={<Timer className="text-muted-foreground size-4" />}
            label="Avg lead time"
            value={avgLead === null ? "—" : `${avgLead} days`}
            hint="Order date → fully received"
          />
          <StatCard
            icon={<CircleAlert className="text-muted-foreground size-4" />}
            label="Overdue tranches"
            value={String(overdue.length)}
            hint="Past due, material outstanding"
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Monthly committed spend</CardTitle>
              <CardDescription>By order month, approved and closed POs</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={spendConfig} className="h-56 w-full">
                <BarChart data={spend} accessibilityLayer>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={72}
                    tickFormatter={(value: number) => `₹${(value / 1000).toFixed(0)}k`}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar isAnimationActive={false} dataKey="spend" fill="var(--color-spend)" radius={4} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Overdue deliveries</CardTitle>
              <CardDescription>Schedule tranches past their date</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {overdue.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Nothing overdue — every open tranche is on track.
                </p>
              ) : (
                overdue.map((tranche, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{tranche.vendorName}</p>
                      <p className="text-muted-foreground text-xs">
                        {tranche.poNumber} · due {tranche.dueDate}
                      </p>
                    </div>
                    <Badge variant="destructive">
                      {tranche.qty - tranche.allocatedQty} short
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Vendor performance</CardTitle>
            <CardDescription>
              On-time rate counts schedule tranches fulfilled by their due date; fill rate is
              accepted ÷ ordered on finished POs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={rows}
              searchColumn="vendorName"
              searchPlaceholder="Search vendor…"
              emptyTitle="No vendors yet"
              emptyDescription="Vendor metrics appear once POs are raised."
              fill={false}
              pageSize={10}
              renderMobileCard={(row) => (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{row.vendorName}</span>
                    {row.onTimeRate !== null ? (
                      <Badge
                        variant={
                          row.onTimeRate >= 80
                            ? "success"
                            : row.onTimeRate >= 50
                              ? "warning"
                              : "destructive"
                        }
                      >
                        {row.onTimeRate}% on-time
                      </Badge>
                    ) : null}
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {row.poCount} POs · {formatPaise(row.totalSpendPaise)}
                    {row.avgLeadDays !== null ? ` · ${row.avgLeadDays} d lead` : ""}
                    {row.fillRate !== null ? ` · fill ${row.fillRate}%` : ""}
                  </span>
                  {row.overdueTrancheCount > 0 ? (
                    <Badge variant="destructive" className="w-fit">
                      {row.overdueTrancheCount} overdue
                    </Badge>
                  ) : null}
                </div>
              )}
            />
          </CardContent>
        </Card>
      </PageBody>
    </Page>
  )
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint: string
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
      </CardContent>
    </Card>
  )
}
