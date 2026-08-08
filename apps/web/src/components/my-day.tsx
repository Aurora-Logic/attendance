import { Link } from "react-router"
import { format } from "date-fns"
import { CalendarPlus, Clock, ScanFace, Wallet } from "lucide-react"

import { cn } from "@/lib/utils"
import { useAttendanceDays, useLeaveBalances, useMyLeaveRequests } from "@/lib/queries"
import { useSession } from "@/lib/session"
import { StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

/**
 * What an employee actually opens the app for: am I punched in, how much leave
 * do I have, and what happened to the request I raised.
 *
 * Before this, everyone landed on the same company dashboard — headcount by
 * department, overtime by department, approval turnaround. All management
 * questions, none of them an employee's. The company view is still there for
 * the roles whose job it is.
 */
export function MyDay() {
  const { user } = useSession()
  const today = new Date().toISOString().slice(0, 10)
  const { rows, source } = useAttendanceDays(today)
  const { balances } = useLeaveBalances()
  const myRequests = useMyLeaveRequests()

  const myDay = rows.find((row) => row.employeeId === user?.employeeId)
  const usable = balances.filter((balance) => balance.balance > 0)
  const pending = (myRequests ?? []).filter((request) => request.status === "PENDING")
  const recent = (myRequests ?? []).slice(0, 4)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Today</CardTitle>
            <CardDescription>
              {format(new Date(), "EEEE, d MMMM yyyy")}
              {source === "demo" ? " · seeded demo data" : ""}
            </CardDescription>
          </div>
          <Button size="sm" asChild>
            <Link to="/punch">
              <ScanFace />
              Punch
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {myDay ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <StatusBadge status={myDay.status} />
              <div className="flex items-center gap-2 text-sm">
                <Clock className="text-muted-foreground size-4" />
                <span className="tabular-nums">
                  {myDay.firstInAt ?? "—"} → {myDay.lastOutAt ?? "—"}
                </span>
              </div>
              <span className="text-muted-foreground text-sm">
                {Math.floor(myDay.workedMinutes / 60)}h{" "}
                {String(myDay.workedMinutes % 60).padStart(2, "0")}m worked
              </span>
              {myDay.lateMinutes > 0 ? (
                <Badge variant="warning">{myDay.lateMinutes} min late</Badge>
              ) : null}
              {myDay.otMinutes > 0 ? (
                <Badge variant="info">
                  {(myDay.otMinutes / 60).toFixed(1)} h past shift end
                </Badge>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No punches yet today. Your first punch in starts the day.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Leave you can take</CardTitle>
              <CardDescription>Balance after everything approved</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/leave">
                <CalendarPlus />
                Apply
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-0">
            {usable.length === 0 ? (
              <p className="text-muted-foreground py-2 text-sm">
                No leave available right now.
              </p>
            ) : (
              usable.map((balance, index) => (
                <div key={balance.code}>
                  {index > 0 ? <Separator /> : null}
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm">{balance.name}</span>
                    <span className="text-sm font-semibold tabular-nums">
                      {balance.balance}
                      <span className="text-muted-foreground ml-1 font-normal">
                        {balance.balance === 1 ? "day" : "days"}
                      </span>
                    </span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your requests</CardTitle>
            <CardDescription>
              {pending.length > 0
                ? `${pending.length} waiting on a decision`
                : "Nothing waiting on a decision"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-0">
            {recent.length === 0 ? (
              <p className="text-muted-foreground py-2 text-sm">
                Nothing raised yet. Applying for leave or regularising a day puts it here.
              </p>
            ) : (
              recent.map((request, index) => (
                <div key={request.id}>
                  {index > 0 ? <Separator /> : null}
                  <div className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{request.type}</p>
                      <p className="text-muted-foreground text-xs tabular-nums">
                        {request.from === request.to
                          ? request.from
                          : `${request.from} → ${request.to}`}
                      </p>
                    </div>
                    <Badge
                      variant={
                        request.status === "APPROVED"
                          ? "success"
                          : request.status === "REJECTED"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {request.status}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className={cn("py-4")}>
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <Wallet className="text-muted-foreground size-4" />
          <span className="text-muted-foreground">
            Payslips are issued after the month is closed and payroll runs.
          </span>
        </CardContent>
      </Card>
    </div>
  )
}
