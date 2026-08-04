import * as React from "react"
import { toast } from "sonner"
import { CalendarCheck, CalendarDays, CalendarX, RefreshCw, Sparkles } from "lucide-react"

import {
  HOLIDAYS_AUG_2026,
  ROSTER_RULES,
  SHIFTS,
  generateRoster,
  type CellSource,
  type RosterRule,
} from "@/lib/roster"
import { cn } from "@/lib/utils"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
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
  MANUAL: "secondary",
}

const SOURCE_LABEL: Record<CellSource, string> = {
  ROTATION: "Rotation",
  DEFAULT: "Default shift",
  WEEKLY_OFF: "Weekly off",
  HOLIDAY: "Holiday",
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
              The roster is derived from these, in order. Turn one off and the grid
              regenerates immediately.
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

/**
 * Declaring a holiday is a per-day action on the date header, so it applies to
 * the whole column at once rather than cell by cell.
 */
function DayHeader({
  day,
  date,
  holidayName,
  onDeclare,
  onClear,
}: {
  day: number
  date: Date
  holidayName?: string
  onDeclare: (name: string) => void
  onClear: () => void
}) {
  const [name, setName] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const isSunday = date.getDay() === 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "hover:bg-accent flex w-full flex-col items-center py-2 leading-tight transition-colors",
            holidayName && "text-status-holiday font-semibold",
            !holidayName && isSunday && "text-muted-foreground"
          )}
          aria-label={`Day ${day}${holidayName ? ` — ${holidayName}` : ""}`}
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
              {date.toLocaleDateString("en-IN", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </p>
            <p className="text-muted-foreground text-sm">
              {holidayName
                ? `Currently a holiday: ${holidayName}`
                : "Declare this day a holiday for every rostered employee."}
            </p>
          </div>

          {holidayName ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onClear()
                setOpen(false)
              }}
            >
              <CalendarX />
              Remove holiday
            </Button>
          ) : (
            <div className="flex flex-col gap-2">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Holiday name, e.g. Diwali"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && name.trim()) {
                    onDeclare(name.trim())
                    setName("")
                    setOpen(false)
                  }
                }}
              />
              <Button
                size="sm"
                disabled={!name.trim()}
                onClick={() => {
                  onDeclare(name.trim())
                  setName("")
                  setOpen(false)
                }}
              >
                <CalendarCheck />
                Mark as holiday
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function RosterPage() {
  const [rules, setRules] = React.useState<RosterRule[]>(() =>
    ROSTER_RULES.map((rule) => ({ ...rule }))
  )
  // Holidays declared here override the generated cell for that whole column.
  const [holidays, setHolidays] = React.useState<Record<number, string>>(
    () => ({ ...HOLIDAYS_AUG_2026 })
  )

  const generated = React.useMemo(() => generateRoster(2026, 7, rules), [rules])
  const grid = React.useMemo(
    () =>
      generated.map((row) => {
        const cells = row.cells.map((cell) =>
          holidays[cell.day]
            ? {
                ...cell,
                status: "HOLIDAY" as const,
                shift: null,
                source: "MANUAL" as const,
                note: holidays[cell.day],
              }
            : cell
        )
        return {
          ...row,
          cells,
          workingDays: cells.filter((cell) => cell.shift !== null).length,
        }
      }),
    [generated, holidays]
  )
  const daysInMonth = grid[0]?.cells.length ?? 31

  const toggleRule = (id: string, enabled: boolean) =>
    setRules((prev) => prev.map((rule) => (rule.id === id ? { ...rule, enabled } : rule)))

  const declareHoliday = (day: number, name: string) => {
    setHolidays((prev) => ({ ...prev, [day]: name }))
    toast.success(`${day} August marked as ${name}`, {
      description: "Applied to every rostered employee. Payable days recalculated.",
    })
  }

  const clearHoliday = (day: number) => {
    setHolidays((prev) => {
      const next = { ...prev }
      delete next[day]
      return next
    })
    toast("Holiday removed", { description: `${day} August is a working day again.` })
  }

  return (
    <Page>
      <PageHeader
        title="Roster"
        description="Generated from the shift patterns. Click any date to declare a holiday."
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
            <RulesPopover rules={rules} onToggle={toggleRule} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.success("Roster regenerated from patterns")}
            >
              <RefreshCw />
              <span className="hidden sm:inline">Regenerate</span>
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
            {SHIFTS.map((shift) => `${shift.short} ${shift.name}`).join(" · ")}
          </span>
        </div>

        {/* Both axes scroll inside this box; the page behind it never moves. */}
        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          <Table className="text-xs">
            <TableHeader className="bg-muted sticky top-0 z-20">
              <TableRow className="hover:bg-transparent">
                <TableHead className="bg-muted sticky left-0 z-30 min-w-[180px]">
                  Employee
                </TableHead>
                {Array.from({ length: daysInMonth }, (_, index) => {
                  const day = index + 1
                  const date = new Date(2026, 7, day)
                  return (
                    <TableHead key={index} className="w-11 p-0 text-center">
                      <DayHeader
                        day={day}
                        date={date}
                        holidayName={holidays[day]}
                        onDeclare={(name) => declareHoliday(day, name)}
                        onClear={() => clearHoliday(day)}
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
