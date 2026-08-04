import * as React from "react"
import { toast } from "sonner"
import { CalendarPlus } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { LEAVE_BALANCES, seedApprovals, seedLeaveLedger, type LeaveLedgerRow } from "@/lib/seed"
import { DataTable } from "@/components/data-table"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const ledgerColumns: ColumnDef<LeaveLedgerRow>[] = [
  { accessorKey: "date", header: "Date" },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ row }) => <Badge variant="outline">{row.original.type}</Badge>,
  },
  {
    accessorKey: "txnType",
    header: "Transaction",
    cell: ({ row }) => (
      <Badge variant={row.original.units < 0 ? "secondary" : "default"}>
        {row.original.txnType.replaceAll("_", " ")}
      </Badge>
    ),
  },
  {
    accessorKey: "units",
    header: "Units",
    cell: ({ row }) => (
      <span className={row.original.units < 0 ? "text-destructive tabular-nums" : "tabular-nums"}>
        {row.original.units > 0 ? "+" : ""}
        {row.original.units}
      </span>
    ),
  },
  {
    accessorKey: "balanceAfter",
    header: "Balance after",
    cell: ({ row }) => <span className="tabular-nums">{row.original.balanceAfter}</span>,
  },
  { accessorKey: "remarks", header: "Remarks" },
]

export function LeavePage() {
  const ledger = React.useMemo(() => seedLeaveLedger(), [])
  const teamLeave = React.useMemo(
    () => seedApprovals().filter((request) => request.kind === "LEAVE").slice(0, 8),
    []
  )
  const [month] = React.useState(() => new Date(2026, 7, 3))

  return (
    <Page>
      <PageHeader
        title="Leave"
        description="Balances are a projection of the ledger — every number here is explainable to a row."
        actions={
          <Button size="sm" onClick={() => toast("Leave application opened")}>
            <CalendarPlus />
            Apply for leave
          </Button>
        }
      />
      <PageBodyFixed>
        <Tabs defaultValue="balances" className="flex min-h-0 flex-1 flex-col gap-4">
          <TabsList className="shrink-0 w-fit max-w-full justify-start overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsTrigger value="balances">Balances</TabsTrigger>
            <TabsTrigger value="ledger">Ledger</TabsTrigger>
            <TabsTrigger value="calendar">Team calendar</TabsTrigger>
          </TabsList>

          <TabsContent value="balances" className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {LEAVE_BALANCES.map((balance) => {
                // LOP has no entitlement to draw down, so a quota bar would be
                // both empty and misleading. It reports a running count instead.
                const isQuota = balance.entitled > 0
                const pct = isQuota
                  ? Math.round((balance.availed / balance.entitled) * 100)
                  : 0
                const tone = !isQuota
                  ? "destructive"
                  : pct >= 85
                    ? "warning"
                    : "success"

                return (
                  <Card key={balance.code}>
                    <CardHeader>
                      <CardDescription className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{balance.code}</Badge>
                        <span className="truncate">{balance.name}</span>
                        {!balance.isPaid ? <Badge variant="destructive">Unpaid</Badge> : null}
                      </CardDescription>
                      <CardTitle className="flex items-baseline gap-2 text-3xl tabular-nums">
                        {isQuota ? balance.balance : balance.availed}
                        <span className="text-muted-foreground text-sm font-normal">
                          {isQuota ? "days left" : "days taken"}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2">
                      {isQuota ? (
                        <>
                          <Progress value={pct} />
                          <p className="text-muted-foreground text-sm">
                            {balance.availed} of {balance.entitled} used
                            <span className="mx-1.5">·</span>
                            <span
                              className={
                                pct >= 85 ? "text-warning font-medium" : undefined
                              }
                            >
                              {pct}%
                            </span>
                          </p>
                        </>
                      ) : (
                        <p className="text-muted-foreground text-sm">
                          No quota — every LOP day is a direct deduction from payable days.
                        </p>
                      )}
                      <Badge variant={tone} className="w-fit">
                        {!isQuota
                          ? "Reduces salary"
                          : pct >= 85
                            ? "Running low"
                            : "Healthy"}
                      </Badge>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </TabsContent>

          <TabsContent value="ledger" className="flex min-h-0 flex-1 flex-col">
            <DataTable
              columns={ledgerColumns}
              data={ledger}
              searchColumn="remarks"
              searchPlaceholder="Search remarks…"
              emptyTitle="No ledger entries"
              emptyDescription="Nothing has been credited or debited in this period."
            />
          </TabsContent>

          <TabsContent
            value="calendar"
            className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[auto_minmax(0,1fr)]"
          >
            <Card className="h-fit w-fit">
              <CardHeader>
                <CardTitle>August 2026</CardTitle>
                <CardDescription>Team leave overlap</CardDescription>
              </CardHeader>
              <CardContent>
                <Calendar mode="single" defaultMonth={month} className="p-0" />
              </CardContent>
            </Card>

            {/* The list owns its own scroll so the card stops growing with the
                data instead of stretching the page. */}
            <Card className="flex min-h-0 flex-col gap-0 py-0">
              <CardHeader className="py-4">
                <CardTitle>Who is away</CardTitle>
                <CardDescription>
                  A configurable cap limits how many of one team can be off the same day.
                </CardDescription>
              </CardHeader>
              <div className="min-h-0 flex-1 divide-y overflow-y-auto border-t">
                {teamLeave.map((request) => (
                  <div
                    key={request.id}
                    className="hover:bg-muted/40 flex items-center gap-3 px-4 py-2.5 transition-colors"
                  >
                    <Avatar className="size-8 shrink-0">
                      <AvatarFallback className="text-xs">{request.initials}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{request.employeeName}</p>
                      <p className="text-muted-foreground truncate text-sm">
                        {request.subject}
                        <span className="mx-1.5 opacity-50">·</span>
                        {request.dateFrom}
                      </p>
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      {request.units.replace(" day(s)", "d")}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </PageBodyFixed>
    </Page>
  )
}
