import * as React from "react"
import { toast } from "sonner"
import { CalendarCheck, CalendarDays, CalendarX, Settings2, Sparkles } from "lucide-react"
import { Link } from "react-router"

import { useAppConfig, type RosterRule } from "@/lib/app-config"
import { useCalendarDays, useSetCalendarDay } from "@/lib/queries"
import { generateRoster, type CellSource } from "@/lib/roster"
import { cn } from "@/lib/utils"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const SOURCE_TONE: Record<CellSource, "success" | "info" | "warning" | "outline" | "secondary"> = {
  ROTATION: "info",
  DEFAULT: "success",
  WEEKLY_OFF: "outline",
  HOLIDAY: "warning",
  HALF_DAY: "warning",
  MANUAL: "secondary",
}

const SOURCE_LABEL: Record<CellSource, string> = {
  ROTATION: "Rotation",
  DEFAULT: "Default shift",
  WEEKLY_OFF: "Weekly off",
  HOLIDAY: "Holiday",
  HALF_DAY: "Half working day",
  MANUAL: "Manual override",
}

function RulesPopover({
  rules,
  onToggle,
}: {
  rules: RosterRule[]
  onToggle: (id: string, enabled: boolean) => void
}) {
  const active = rules.filter((rule) => rule.enabled).length
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Sparkles />
          Rules
          <Badge variant="secondary">{active}</Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium">Generation rules</p>
            <p className="text-muted-foreground text-sm">
              The grid regenerates the moment a rule changes. Patterns, shifts and the rotation are
              edited in{" "}
              <Link to="/settings" className="underline underline-offset-2">
                Settings → Roster & shifts
              </Link>
              .
            </p>
          </div>
          {rules.map((rule) => (
            <Field key={rule.id} orientation="horizontal">
              <Switch
                id={`rule-${rule.id}`}
                checked={rule.enabled}
                onCheckedChange={(checked) => onToggle(rule.id, checked)}
              />
              <FieldContent>
                <FieldLabel htmlFor={`rule-${rule.id}`}>{rule.label}</FieldLabel>
                <FieldDescription>{rule.detail}</FieldDescription>
              </FieldContent>
            </Field>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Declaring a holiday is a per-day action on the date header — whole column at once. */
function DayHeader({
  day,
  date,
  declared,
  onDeclare,
  onClear,
}: {
  day: number
  date: Date
  declared?: { name: string; type: "HOLIDAY" | "HALF_DAY" }
  onDeclare: (name: string, type: "HOLIDAY" | "HALF_DAY") => void
  onClear: () => void
}) {
  const [name, setName] = React.useState("")
  const [type, setType] = React.useState<"HOLIDAY" | "HALF_DAY">("HOLIDAY")
  const [open, setOpen] = React.useState(false)
  const isSunday = date.getDay() === 0

  const declare = () => {
    if (!name.trim()) return
    onDeclare(name.trim(), type)
    setName("")
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "hover:bg-accent flex w-full flex-col items-center py-2 leading-tight transition-colors",
            declared?.type === "HOLIDAY" && "text-status-holiday font-semibold",
            declared?.type === "HALF_DAY" && "text-status-half-day font-semibold",
            !declared && isSunday && "text-muted-foreground"
          )}
          aria-label={`Day ${day}${declared ? ` — ${declared.name}` : ""}`}
        >
          <span>{day}</span>
          <span className="text-[10px] font-normal opacity-60">
            {date.toLocaleDateString("en-IN", { weekday: "narrow" })}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-72">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-medium">
              {date.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <p className="text-muted-foreground text-sm">
              {declared
                ? `Currently ${declared.type === "HOLIDAY" ? "a holiday" : "a half working day"}: ${declared.name}`
                : "Declare this day for every rostered employee."}
            </p>
          </div>
          {declared ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onClear()
                setOpen(false)
              }}
            >
              <CalendarX />
              Remove {declared.type === "HOLIDAY" ? "holiday" : "half day"}
            </Button>
          ) : (
            <div className="flex flex-col gap-2">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Diwali, or Festival eve"
                onKeyDown={(event) => event.key === "Enter" && declare()}
              />
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={type}
                onValueChange={(value) => value && setType(value as "HOLIDAY" | "HALF_DAY")}
                className="w-full"
              >
                <ToggleGroupItem value="HOLIDAY" className="flex-1">
                  Holiday
                </ToggleGroupItem>
                <ToggleGroupItem value="HALF_DAY" className="flex-1">
                  Half day
                </ToggleGroupItem>
              </ToggleGroup>
              <p className="text-muted-foreground text-xs">
                {type === "HOLIDAY"
                  ? "Paid for everyone, no punches expected."
                  : "A working day with the expectation halved — half the hours still earn a full day."}
              </p>
              <Button size="sm" disabled={!name.trim()} onClick={declare}>
                <CalendarCheck />
                Mark as {type === "HOLIDAY" ? "holiday" : "half day"}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function RosterPage() {
  const { roster, setRoster, declareDay, clearDay } = useAppConfig()
  const { days: apiDays } = useCalendarDays()
  const calendarMutations = useSetCalendarDay()

  // Postgres wins when signed in through the API; otherwise the local config.
  const declaredDays: Record<string, { name: string; type: "HOLIDAY" | "HALF_DAY" }> =
    apiDays ??
    Object.fromEntries([
      ...Object.entries(roster.holidays).map(([date, name]) => [
        date,
        { name, type: "HOLIDAY" as const },
      ]),
      ...Object.entries(roster.halfDays).map(([date, name]) => [
        date,
        { name, type: "HALF_DAY" as const },
      ]),
    ])

  const effectiveRoster = React.useMemo(
    () =>
      apiDays
        ? {
            ...roster,
            holidays: Object.fromEntries(
              Object.entries(apiDays)
                .filter(([, day]) => day.type === "HOLIDAY")
                .map(([date, day]) => [date, day.name])
            ),
            halfDays: Object.fromEntries(
              Object.entries(apiDays)
                .filter(([, day]) => day.type === "HALF_DAY")
                .map(([date, day]) => [date, day.name])
            ),
          }
        : roster,
    [roster, apiDays]
  )
  const grid = React.useMemo(() => generateRoster(2026, 7, effectiveRoster), [effectiveRoster])
  const daysInMonth = grid[0]?.cells.length ?? 31

  const toggleRule = (id: string, enabled: boolean) =>
    setRoster((prev) => ({
      ...prev,
      rules: prev.rules.map((rule) => (rule.id === id ? { ...rule, enabled } : rule)),
    }))

  return (
    <Page>
      <PageHeader
        title="Roster"
        description="August 2026 · generated from the configured patterns. Click any date to declare a holiday."
        actions={
          <>
            <Select defaultValue="all">
              <SelectTrigger size="sm" className="w-36 sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                <SelectItem value="ho">Mumbai HO</SelectItem>
                <SelectItem value="pune">Pune Plant</SelectItem>
                <SelectItem value="blr">Bengaluru Office</SelectItem>
              </SelectContent>
            </Select>
            <RulesPopover rules={roster.rules} onToggle={toggleRule} />
            <Button variant="outline" size="sm" asChild>
              <Link to="/settings">
                <Settings2 />
                <span className="hidden sm:inline">Customise</span>
              </Link>
            </Button>
            <Button size="sm" onClick={() => toast.success("Roster published to employees")}>
              <CalendarDays />
              <span className="hidden sm:inline">Publish</span>
            </Button>
          </>
        }
      />
      <PageBodyFixed>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {(Object.keys(SOURCE_LABEL) as CellSource[]).map((source) => (
            <Badge key={source} variant={SOURCE_TONE[source]}>
              {SOURCE_LABEL[source]}
            </Badge>
          ))}
          <span className="text-muted-foreground ml-auto hidden text-xs sm:inline">
            {roster.shifts.map((shift) => `${shift.short} ${shift.name}`).join(" · ")}
          </span>
        </div>

        {/* Both axes scroll inside this box; the page behind it never moves. */}
        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          <Table className="text-xs">
            <TableHeader className="bg-muted sticky top-0 z-20">
              <TableRow className="hover:bg-transparent">
                <TableHead className="bg-muted sticky left-0 z-30 min-w-[180px]">Employee</TableHead>
                {Array.from({ length: daysInMonth }, (_, index) => {
                  const day = index + 1
                  const date = new Date(2026, 7, day)
                  const dateISO = `2026-08-${String(day).padStart(2, "0")}`
                  return (
                    <TableHead key={index} className="w-11 p-0 text-center">
                      <DayHeader
                        day={day}
                        date={date}
                        declared={declaredDays[dateISO]}
                        onDeclare={(name, type) => {
                          const label = type === "HOLIDAY" ? "holiday" : "half working day"
                          if (apiDays) {
                            calendarMutations.declare.mutate(
                              { date: dateISO, name, type },
                              {
                                onSuccess: () =>
                                  toast.success(`${day} August marked as a ${label}`, {
                                    description:
                                      type === "HALF_DAY"
                                        ? "Half the hours now earn a full payable day."
                                        : "Paid for everyone; punches route as comp-off claims.",
                                  }),
                                onError: () => toast.error("Could not save — admin rights required"),
                              }
                            )
                          } else {
                            declareDay(dateISO, name, type)
                            toast.success(`${day} August marked as a ${label}`)
                          }
                        }}
                        onClear={() => {
                          if (apiDays) {
                            calendarMutations.clear.mutate(dateISO, {
                              onSuccess: () => toast(`${day} August is an ordinary working day again`),
                              onError: () => toast.error("Could not clear — admin rights required"),
                            })
                          } else {
                            clearDay(dateISO)
                            toast(`${day} August is an ordinary working day again`)
                          }
                        }}
                      />
                    </TableHead>
                  )
                })}
                <TableHead className="bg-muted sticky right-0 z-30 text-right">Days</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grid.map((row) => (
                <TableRow key={row.employee.id}>
                  <TableCell className="bg-background sticky left-0 z-10">
                    <div className="flex flex-col">
                      <span className="font-medium">{row.employee.name}</span>
                      <span className="text-muted-foreground">
                        {row.employee.code} · {row.employee.department}
                      </span>
                    </div>
                  </TableCell>
                  {row.cells.map((cell) => (
                    <TableCell key={cell.day} className="p-1 text-center">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                            variant={SOURCE_TONE[cell.source]}
                            className="w-9 justify-center px-0 font-mono"
                          >
                            {cell.status === "WEEKLY_OFF"
                              ? "WO"
                              : cell.status === "HOLIDAY"
                                ? "H"
                                : (cell.shift?.short ?? "—")}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="font-medium">
                            {row.employee.name} · {cell.day} Aug
                          </p>
                          <p>{cell.note}</p>
                          <p className="opacity-70">Rule: {SOURCE_LABEL[cell.source]}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                  ))}
                  <TableCell className="bg-background sticky right-0 z-10 text-right font-medium tabular-nums">
                    {row.workingDays}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </PageBodyFixed>
    </Page>
  )
}
