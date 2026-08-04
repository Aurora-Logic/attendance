import * as React from "react"
import { toast } from "sonner"
import { CalendarRange, Download, FileSpreadsheet, Loader2 } from "lucide-react"
import { format } from "date-fns"
import type { DateRange } from "react-day-picker"

import { EXPORT_JOBS, REPORTS } from "@/lib/seed"
import { Page, PageBody, PageHeader } from "@/components/page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"

/** `date-picker` is not a registry component — it is popover + calendar. */
function DateRangePicker() {
  const [range, setRange] = React.useState<DateRange | undefined>({
    from: new Date(2026, 6, 1),
    to: new Date(2026, 6, 31),
  })

  const label =
    range?.from && range?.to
      ? `${format(range.from, "d MMM")} – ${format(range.to, "d MMM yyyy")}`
      : "Pick a range"

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarRange />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="range" selected={range} onSelect={setRange} numberOfMonths={2} />
      </PopoverContent>
    </Popover>
  )
}

export function ReportsPage() {
  return (
    <Page>
      <PageHeader
        title="Reports"
        description="Every report exports a real .xlsx — typed cells, frozen headers, auto-filter, totals as SUM formulas."
        actions={
          <>
            <DateRangePicker />
            <Select defaultValue="all">
              <SelectTrigger size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                <SelectItem value="ho">Mumbai HO</SelectItem>
                <SelectItem value="pune">Pune Plant</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />
      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle>Export queue</CardTitle>
            <CardDescription>
              Anything over ~5,000 rows runs as a background job with a streaming writer, so the
              request thread is never blocked.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-0">
            {EXPORT_JOBS.map((job, index) => (
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
                      {job.report} · {job.rows.toLocaleString("en-IN")} rows · queued {job.requestedAt}
                    </ItemDescription>
                    {job.status === "RUNNING" ? (
                      <Progress value={job.progress} className="mt-1" />
                    ) : null}
                  </ItemContent>
                  <ItemActions>
                    <Badge variant={job.status === "READY" ? "default" : "secondary"}>
                      {job.status}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={job.status !== "READY"}
                      onClick={() => toast.success(`Downloading ${job.filename}`)}
                    >
                      <Download />
                      Download
                    </Button>
                  </ItemActions>
                </Item>
              </React.Fragment>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {REPORTS.map((report) => (
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
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() =>
                      toast.success("Export queued", {
                        description: `Delta_${report.key}_All_2026-07.xlsx`,
                      })
                    }
                  >
                    <FileSpreadsheet />
                    Export .xlsx
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => toast("Opening on-screen view")}>
                    View
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageBody>
    </Page>
  )
}
