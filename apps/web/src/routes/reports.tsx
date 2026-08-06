import * as React from "react"
import { toast } from "sonner"
import { useNavigate } from "react-router"
import { Download, Eye, FileSpreadsheet, Loader2 } from "lucide-react"

import { API_BASE } from "@/lib/api"
import { exportDailyRegisterExcel } from "@/lib/attendance-export"
import { useAttendanceDays, useEnqueueExport, useExportJobs } from "@/lib/queries"
import { useSession } from "@/lib/session"
import { EXPORT_JOBS, REPORTS, seedAttendanceDays } from "@/lib/seed"
import { Page, PageBody, PageHeader } from "@/components/page-shell"
import { CustomReportsCard } from "@/components/report-builder-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * Which screen previews each report today. Reports without a surface yet keep
 * their buttons disabled with the reason — no button pretends.
 */
const REPORT_ROUTES: Record<string, string> = {
  "daily-register": "/attendance",
  "muster-roll": "/roster",
  "leave-balance": "/leave",
}

const PHASE_NOTE = "Ships with the Phase 6 export worker (server-side ExcelJS + BullMQ)."

export function ReportsPage() {
  const navigate = useNavigate()
  const { user } = useSession()
  const { jobs } = useExportJobs()
  const enqueue = useEnqueueExport()
  const today = new Date().toISOString().slice(0, 10)
  const { rows: todayRows, source: daySource } = useAttendanceDays(today)
  const present = todayRows.filter((row) =>
    ["PRESENT", "ON_DUTY", "WFH"].includes(row.status)
  ).length
  const onLeave = todayRows.filter((row) => row.status.startsWith("ON_LEAVE")).length
  const pendingApproval = todayRows.filter((row) => row.approvalStatus === "PENDING").length

  const exportDaily = () => {
    // API session: queue the server-side build (§7 — the request thread never
    // builds a file). Demo: the client workbook keeps the feature usable.
    if (user?.source === "api") {
      enqueue.mutate(
        { report: "daily-register", date: today },
        {
          onSuccess: ({ job }) =>
            toast.success("Export queued on the server", {
              description: `${job.filename} — the queue below tracks it to Ready.`,
            }),
          onError: () => toast.error("Queue unavailable — is Redis up?"),
        }
      )
      return
    }
    const rows = seedAttendanceDays()
    void exportDailyRegisterExcel(rows, "2026-08-03").then(() =>
      toast.success("Daily register exported (client, demo)", {
        description: `${rows.length} rows → Delta_DailyRegister_2026-08-03.xlsx`,
      })
    )
  }

  return (
    <Page>
      {/* No decorative filters up here: a control that filters nothing is a
          broken promise. The report builder below owns its real date picker. */}
      <PageHeader
        title="Reports"
        description="Every export is a real .xlsx — typed cells, frozen headers, auto-filter, totals as SUM formulas."
      />
      <PageBody>
        {/* The live headline numbers live HERE by product decision — screens
            show the work, Reports shows the figures. One line, no tiles. */}
        <Card className="py-4">
          <CardContent className="text-sm">
            <span className="font-medium">Today{daySource === "demo" ? " (seeded)" : ""}: </span>
            <span className="text-status-present font-semibold tabular-nums">{present}</span> present
            <span className="text-muted-foreground mx-1.5">·</span>
            <span className="font-semibold tabular-nums">{onLeave}</span> on leave
            <span className="text-muted-foreground mx-1.5">·</span>
            <span className="text-status-half-day font-semibold tabular-nums">{pendingApproval}</span>{" "}
            awaiting approval
            <span className="text-muted-foreground mx-1.5">·</span>
            {todayRows.length} rostered
          </CardContent>
        </Card>

        <CustomReportsCard />

        <Card>
          <CardHeader>
            <CardTitle>Export queue</CardTitle>
            <CardDescription>
              {jobs
                ? "Live: BullMQ on Redis, workbooks built server-side with ExcelJS. Download when Ready."
                : "Preview — sign in with the API and Redis running for the live queue."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-0">
            {jobs && jobs.length === 0 ? (
              <p className="text-muted-foreground py-2 text-sm">
                Nothing queued yet — press Export on a report below.
              </p>
            ) : null}
            {(jobs ?? EXPORT_JOBS).map((job, index) => (
              <React.Fragment key={job.id}>
                {index > 0 ? <Separator /> : null}
                <Item size="sm">
                  <ItemMedia>
                    {job.status === "RUNNING" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="size-4" />
                    )}
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="font-mono text-xs">{job.filename}</ItemTitle>
                    <ItemDescription>
                      {job.report}
                      {"rowCount" in job && job.rowCount
                        ? ` · ${job.rowCount.toLocaleString("en-IN")} rows`
                        : "rows" in job
                          ? ` · ${(job as { rows: number }).rows.toLocaleString("en-IN")} rows`
                          : ""}
                      {"error" in job && job.error ? ` · ${job.error}` : ""}
                    </ItemDescription>
                    {job.status === "RUNNING" || job.status === "QUEUED" ? (
                      <Progress value={job.status === "RUNNING" ? 66 : 15} className="mt-1" />
                    ) : null}
                  </ItemContent>
                  <ItemActions>
                    <Badge
                      variant={
                        job.status === "READY"
                          ? "success"
                          : job.status === "FAILED"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {job.status}
                    </Badge>
                    {jobs ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={job.status !== "READY"}
                        onClick={() =>
                          window.open(`${API_BASE}/exports/${job.id}/download`, "_blank")
                        }
                      >
                        <Download />
                        Download
                      </Button>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button variant="outline" size="sm" disabled>
                              <Download />
                              Download
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{PHASE_NOTE}</TooltipContent>
                      </Tooltip>
                    )}
                  </ItemActions>
                </Item>
              </React.Fragment>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {REPORTS.map((report) => {
            const route = REPORT_ROUTES[report.key]
            const exportable = report.key === "daily-register"
            return (
              <Card key={report.key} className="flex flex-col">
                <CardHeader>
                  <CardTitle className="text-base">{report.title}</CardTitle>
                  <CardDescription>{report.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col justify-end gap-3">
                  <div className="flex flex-wrap gap-1">
                    {report.sheets.map((sheet) => (
                      <Badge key={sheet} variant="outline">
                        {sheet}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    {exportable ? (
                      <Button size="sm" className="flex-1" onClick={exportDaily}>
                        <FileSpreadsheet />
                        Export .xlsx
                      </Button>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="flex-1">
                            <Button size="sm" className="w-full" disabled>
                              <FileSpreadsheet />
                              Export .xlsx
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{PHASE_NOTE}</TooltipContent>
                      </Tooltip>
                    )}
                    {route ? (
                      <Button variant="outline" size="sm" onClick={() => navigate(route)}>
                        <Eye />
                        View
                      </Button>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button variant="outline" size="sm" disabled>
                              <Eye />
                              View
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>On-screen view lands in Phase 6.</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </PageBody>
    </Page>
  )
}
