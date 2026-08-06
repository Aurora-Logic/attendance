import * as React from "react"
import { format } from "date-fns"
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  CalendarIcon,
  FileSpreadsheet,
  ListPlus,
  Pencil,
  Play,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { DAY_STATUS, type DayStatus } from "@attendance/shared"

import { useAppConfig } from "@/lib/app-config"
import { useAttendanceDays, useDepartments } from "@/lib/queries"
import {
  applyReport,
  columnSpec,
  deleteReportDef,
  exportCustomReportExcel,
  loadReportDefs,
  REPORT_COLUMNS,
  saveReportDef,
  type CustomReportDef,
  type ReportColumnKey,
  type ReportGroupBy,
} from "@/lib/report-builder"
import { DAY_STATUS_META, StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

const EMPTY_DRAFT: Omit<CustomReportDef, "id"> = {
  name: "",
  columns: ["code", "name", "department", "status", "in", "lateMin"],
  statuses: [],
  departments: [],
  groupBy: "none",
  sortBy: "code",
  sortDir: "asc",
}

function summarise(def: CustomReportDef): string {
  const parts = [`${def.columns.length} columns`]
  if (def.statuses.length > 0) parts.push(`${def.statuses.length} statuses`)
  if (def.departments.length > 0) parts.push(def.departments.join(", "))
  if (def.groupBy !== "none") parts.push(`grouped by ${def.groupBy}`)
  return parts.join(" · ")
}

/**
 * The report builder: saved definitions run over live attendance rows for any
 * date, preview on-screen, and export to a real workbook. Definitions are the
 * user's own — create, edit, delete (§ "reports I can manage as I want").
 */
export function CustomReportsCard() {
  const { branding } = useAppConfig()
  const { departments } = useDepartments()
  const [defs, setDefs] = React.useState<CustomReportDef[]>(() => loadReportDefs())
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [runDate, setRunDate] = React.useState<Date>(() => new Date())
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<CustomReportDef | null>(null)

  const runDateISO = format(runDate, "yyyy-MM-dd")
  const { rows, source } = useAttendanceDays(runDateISO)
  const active = defs.find((def) => def.id === activeId) ?? null
  const groups = React.useMemo(
    () => (active ? applyReport(rows, active) : []),
    [rows, active]
  )
  const totalRows = groups.reduce((sum, group) => sum + group.rows.length, 0)

  const openNew = () => {
    setDraft({ id: crypto.randomUUID(), ...EMPTY_DRAFT })
    setSheetOpen(true)
  }
  const openEdit = (def: CustomReportDef) => {
    setDraft({ ...def })
    setSheetOpen(true)
  }
  const saveDraft = () => {
    if (!draft) return
    if (draft.name.trim().length === 0) {
      toast.error("Give the report a name.")
      return
    }
    if (draft.columns.length === 0) {
      toast.error("Pick at least one column.")
      return
    }
    if (!draft.columns.includes(draft.sortBy)) draft.sortBy = draft.columns[0]
    const next = saveReportDef({ ...draft, name: draft.name.trim() })
    setDefs(next)
    setActiveId(draft.id)
    setSheetOpen(false)
    toast.success("Report saved", { description: draft.name.trim() })
  }
  const removeDef = (def: CustomReportDef) => {
    setDefs(deleteReportDef(def.id))
    if (activeId === def.id) setActiveId(null)
    toast.success("Report deleted", { description: def.name })
  }
  const exportActive = () => {
    if (!active) return
    void exportCustomReportExcel(active, groups, runDateISO, branding.companyName).then(() =>
      toast.success("Report exported", {
        description: `${totalRows} rows → ${active.name} · ${runDateISO}`,
      })
    )
  }

  const toggleDraftColumn = (key: ReportColumnKey, checked: boolean) => {
    setDraft((current) => {
      if (!current) return current
      const columns = checked
        ? REPORT_COLUMNS.map((column) => column.key).filter(
            (candidate) => current.columns.includes(candidate) || candidate === key
          )
        : current.columns.filter((candidate) => candidate !== key)
      return { ...current, columns }
    })
  }
  const toggleDraftDepartment = (name: string, checked: boolean) => {
    setDraft((current) => {
      if (!current) return current
      const next = checked
        ? [...current.departments, name]
        : current.departments.filter((candidate) => candidate !== name)
      return { ...current, departments: next }
    })
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Custom reports</CardTitle>
          <CardDescription>
            Compose columns, filters and grouping over the attendance register — run for any
            date, export as .xlsx.
          </CardDescription>
        </div>
        <Button size="sm" onClick={openNew}>
          <ListPlus />
          New report
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {defs.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileSpreadsheet />
              </EmptyMedia>
              <EmptyTitle>No custom reports yet</EmptyTitle>
              <EmptyDescription>
                Build your first one — pick the columns you care about, filter by status or
                department, group and export.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col">
            {defs.map((def, index) => (
              <React.Fragment key={def.id}>
                {index > 0 ? <Separator /> : null}
                <Item size="sm" data-active={def.id === activeId}>
                  <ItemContent>
                    <ItemTitle>
                      {def.name}
                      {def.id === activeId ? (
                        <Badge variant="info" className="ml-1.5">
                          Active
                        </Badge>
                      ) : null}
                    </ItemTitle>
                    <ItemDescription>{summarise(def)}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      variant={def.id === activeId ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => setActiveId(def.id === activeId ? null : def.id)}
                    >
                      <Play />
                      {def.id === activeId ? "Close" : "Run"}
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => openEdit(def)}>
                      <Pencil />
                      <span className="sr-only">Edit {def.name}</span>
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => removeDef(def)}>
                      <Trash2 />
                      <span className="sr-only">Delete {def.name}</span>
                    </Button>
                  </ItemActions>
                </Item>
              </React.Fragment>
            ))}
          </div>
        )}

        {active ? (
          <>
            <Separator />
            <div className="flex flex-wrap items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <CalendarIcon />
                    {format(runDate, "d MMM yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={runDate}
                    onSelect={(date) => date && setRunDate(date)}
                  />
                </PopoverContent>
              </Popover>
              <span className="text-muted-foreground text-sm">
                {totalRows} rows{source === "demo" ? " (seeded)" : ""}
              </span>
              <Button
                size="sm"
                className="ml-auto"
                onClick={exportActive}
                disabled={totalRows === 0}
              >
                <FileSpreadsheet />
                Export .xlsx
              </Button>
            </div>
            <div className="max-h-96 overflow-auto rounded-md border">
              <Table>
                <TableHeader className="bg-background sticky top-0 z-10">
                  <TableRow>
                    {active.columns.map((key) => {
                      const column = columnSpec(key)
                      return (
                        <TableHead
                          key={key}
                          className={column.kind === "number" ? "text-right" : undefined}
                        >
                          {column.label}
                        </TableHead>
                      )
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {totalRows === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={active.columns.length}
                        className="text-muted-foreground h-16 text-center"
                      >
                        No rows match the filters for {runDateISO}.
                      </TableCell>
                    </TableRow>
                  ) : (
                    groups.map((group) => (
                      <React.Fragment key={group.label ?? "all"}>
                        {group.label !== null ? (
                          <TableRow className="bg-muted/50 hover:bg-muted/50">
                            <TableCell
                              colSpan={active.columns.length}
                              className="py-1.5 text-xs font-semibold"
                            >
                              {group.label}
                              <span className="text-muted-foreground ml-1.5 font-normal">
                                {group.rows.length} rows
                              </span>
                            </TableCell>
                          </TableRow>
                        ) : null}
                        {group.rows.map((row) => (
                          <TableRow key={row.id}>
                            {active.columns.map((key) => {
                              const column = columnSpec(key)
                              return (
                                <TableCell
                                  key={key}
                                  className={
                                    column.kind === "number"
                                      ? "text-right tabular-nums"
                                      : undefined
                                  }
                                >
                                  {key === "status" ? (
                                    <StatusBadge status={row.status} />
                                  ) : (
                                    column.value(row)
                                  )}
                                </TableCell>
                              )
                            })}
                          </TableRow>
                        ))}
                      </React.Fragment>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        ) : null}
      </CardContent>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{defs.some((def) => def.id === draft?.id) ? "Edit report" : "New report"}</SheetTitle>
            <SheetDescription>
              The definition is yours — it runs over live register rows every time.
            </SheetDescription>
          </SheetHeader>
          {draft ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="report-name">Name</FieldLabel>
                  <Input
                    id="report-name"
                    value={draft.name}
                    placeholder="Late arrivals — Operations"
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, name: event.target.value } : current
                      )
                    }
                  />
                </Field>

                <Field>
                  <FieldLabel>Columns</FieldLabel>
                  <div className="grid grid-cols-2 gap-2">
                    {REPORT_COLUMNS.map((column) => (
                      <Label
                        key={column.key}
                        className="flex items-center gap-2 text-sm font-normal"
                      >
                        <Checkbox
                          checked={draft.columns.includes(column.key)}
                          onCheckedChange={(checked) =>
                            toggleDraftColumn(column.key, checked === true)
                          }
                        />
                        {column.label}
                      </Label>
                    ))}
                  </div>
                  <FieldDescription>Catalog order is kept; pick what matters.</FieldDescription>
                </Field>

                <Field>
                  <FieldLabel>Status filter</FieldLabel>
                  <ToggleGroup
                    type="multiple"
                    variant="outline"
                    size="sm"
                    className="flex-wrap justify-start"
                    value={draft.statuses}
                    onValueChange={(value) =>
                      setDraft((current) =>
                        current ? { ...current, statuses: value as DayStatus[] } : current
                      )
                    }
                  >
                    {DAY_STATUS.map((status) => (
                      <ToggleGroupItem
                        key={status}
                        value={status}
                        title={DAY_STATUS_META[status].label}
                      >
                        {DAY_STATUS_META[status].short}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <FieldDescription>Nothing selected = every status.</FieldDescription>
                </Field>

                <Field>
                  <FieldLabel>Departments</FieldLabel>
                  <div className="grid grid-cols-2 gap-2">
                    {departments
                      .filter((department) => department.isActive)
                      .map((department) => (
                        <Label
                          key={department.id}
                          className="flex items-center gap-2 text-sm font-normal"
                        >
                          <Checkbox
                            checked={draft.departments.includes(department.name)}
                            onCheckedChange={(checked) =>
                              toggleDraftDepartment(department.name, checked === true)
                            }
                          />
                          {department.name}
                        </Label>
                      ))}
                  </div>
                  <FieldDescription>Nothing selected = every department.</FieldDescription>
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field>
                    <FieldLabel htmlFor="report-group">Group by</FieldLabel>
                    <Select
                      value={draft.groupBy}
                      onValueChange={(value) =>
                        setDraft((current) =>
                          current ? { ...current, groupBy: value as ReportGroupBy } : current
                        )
                      }
                    >
                      <SelectTrigger id="report-group">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="department">Department</SelectItem>
                        <SelectItem value="status">Status</SelectItem>
                        <SelectItem value="shift">Shift</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="report-sort">Sort by</FieldLabel>
                    <div className="flex gap-1.5">
                      <Select
                        value={draft.sortBy}
                        onValueChange={(value) =>
                          setDraft((current) =>
                            current
                              ? { ...current, sortBy: value as ReportColumnKey }
                              : current
                          )
                        }
                      >
                        <SelectTrigger id="report-sort" className="flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {draft.columns.map((key) => (
                            <SelectItem key={key} value={key}>
                              {columnSpec(key).label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        title={draft.sortDir === "asc" ? "Ascending" : "Descending"}
                        onClick={() =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  sortDir: current.sortDir === "asc" ? "desc" : "asc",
                                }
                              : current
                          )
                        }
                      >
                        {draft.sortDir === "asc" ? (
                          <ArrowUpNarrowWide />
                        ) : (
                          <ArrowDownWideNarrow />
                        )}
                      </Button>
                    </div>
                  </Field>
                </div>
              </FieldGroup>
            </div>
          ) : null}
          <SheetFooter className="flex-row border-t">
            <SheetClose asChild>
              <Button variant="outline" className="flex-1">
                Cancel
              </Button>
            </SheetClose>
            <Button className="flex-1" onClick={saveDraft}>
              Save report
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </Card>
  )
}
