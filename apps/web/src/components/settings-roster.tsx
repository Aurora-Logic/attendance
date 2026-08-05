import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
import type { ShiftSpec } from "@attendance/shared"

import { useAppConfig, type WeeklyOffPattern } from "@/lib/app-config"
import { DEPARTMENTS } from "@/lib/seed"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { TimeSelect } from "@/components/time-select"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"]

/**
 * Settings → Roster & shifts. Everything the roster generator reads is edited
 * here — the grid on the Roster page regenerates the moment any of it changes.
 */
export function RosterSettings() {
  const { roster, setRoster } = useAppConfig()

  const updateShift = (shiftId: string, patch: Partial<ShiftSpec>) =>
    setRoster((prev) => ({
      ...prev,
      shifts: prev.shifts.map((shift) => (shift.id === shiftId ? { ...shift, ...patch } : shift)),
    }))

  const removeShift = (shiftId: string) =>
    setRoster((prev) => ({
      ...prev,
      shifts: prev.shifts.filter((shift) => shift.id !== shiftId),
      rotation: {
        ...prev.rotation,
        cycle: prev.rotation.cycle.filter((candidate) => candidate !== shiftId),
      },
    }))

  const addShift = () =>
    setRoster((prev) => ({
      ...prev,
      shifts: [
        ...prev.shifts,
        {
          id: `shift_${Date.now()}`,
          name: "New shift",
          short: "S",
          startMin: 540,
          endMin: 1080,
          breakMin: 30,
        },
      ],
    }))

  const updatePattern = (patternId: string, patch: Partial<WeeklyOffPattern>) =>
    setRoster((prev) => ({
      ...prev,
      patterns: prev.patterns.map((pattern) =>
        pattern.id === patternId ? { ...pattern, ...patch } : pattern
      ),
    }))

  const addPattern = () =>
    setRoster((prev) => ({
      ...prev,
      patterns: [
        ...prev.patterns,
        { id: `pat_${Date.now()}`, name: "New pattern", fixedDays: [0], alternateSaturdays: [] },
      ],
    }))

  const removePattern = (patternId: string) =>
    setRoster((prev) => {
      if (prev.patterns.length <= 1) {
        toast.error("At least one weekly-off pattern must exist.")
        return prev
      }
      const departmentPatterns = Object.fromEntries(
        Object.entries(prev.departmentPatterns).filter(([, value]) => value !== patternId)
      )
      return {
        ...prev,
        patterns: prev.patterns.filter((pattern) => pattern.id !== patternId),
        departmentPatterns,
      }
    })

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Shifts</CardTitle>
          <CardDescription>
            End before start means the shift crosses midnight — the business-date rule handles it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {roster.shifts.map((shift) => (
            <div
              key={shift.id}
              className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
            >
              <Input
                value={shift.name}
                onChange={(event) => updateShift(shift.id, { name: event.target.value })}
                className="w-32"
                aria-label="Shift name"
              />
              <Input
                value={shift.short}
                onChange={(event) =>
                  updateShift(shift.id, { short: event.target.value.slice(0, 2).toUpperCase() })
                }
                className="w-14 text-center font-mono"
                aria-label="Muster code"
              />
              <TimeSelect
                value={shift.startMin}
                onChange={(startMin) => updateShift(shift.id, { startMin })}
                className="w-28"
                ariaLabel="Start time"
              />
              <span className="text-muted-foreground text-sm">to</span>
              <TimeSelect
                value={shift.endMin}
                onChange={(endMin) => updateShift(shift.id, { endMin })}
                className="w-28"
                ariaLabel="End time"
              />
              {shift.endMin <= shift.startMin ? <Badge variant="info">Night</Badge> : null}
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto"
                aria-label={`Remove ${shift.name}`}
                onClick={() => removeShift(shift.id)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="w-fit" onClick={addShift}>
            <Plus />
            Add shift
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Weekly-off patterns</CardTitle>
          <CardDescription>
            Fixed days plus optional alternate Saturdays (pick which occurrences are off).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {roster.patterns.map((pattern) => (
            <div key={pattern.id} className="flex flex-col gap-2 rounded-md border px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={pattern.name}
                  onChange={(event) => updatePattern(pattern.id, { name: event.target.value })}
                  className="w-56"
                  aria-label="Pattern name"
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto"
                  aria-label={`Remove ${pattern.name}`}
                  onClick={() => removePattern(pattern.id)}
                >
                  <Trash2 />
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <ToggleGroup
                  type="multiple"
                  variant="outline"
                  size="sm"
                  value={pattern.fixedDays.map(String)}
                  onValueChange={(values) =>
                    updatePattern(pattern.id, { fixedDays: values.map(Number).sort() })
                  }
                  aria-label="Fixed off days"
                >
                  {DAY_LETTERS.map((letter, dayIndex) => (
                    <ToggleGroupItem key={dayIndex} value={String(dayIndex)} className="w-8">
                      {letter}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {!pattern.fixedDays.includes(6) ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground text-xs">Alt. Saturdays</span>
                    <ToggleGroup
                      type="multiple"
                      variant="outline"
                      size="sm"
                      value={pattern.alternateSaturdays.map(String)}
                      onValueChange={(values) =>
                        updatePattern(pattern.id, {
                          alternateSaturdays: values.map(Number).sort(),
                        })
                      }
                      aria-label="Alternate Saturday occurrences"
                    >
                      {[1, 2, 3, 4, 5].map((occurrence) => (
                        <ToggleGroupItem key={occurrence} value={String(occurrence)} className="w-8">
                          {occurrence}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" className="w-fit" onClick={addPattern}>
            <Plus />
            Add pattern
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pattern per department</CardTitle>
            <CardDescription>Unlisted departments use the first pattern.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {DEPARTMENTS.map((department) => (
              <Field key={department} orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor={`dept-${department}`}>{department}</FieldLabel>
                </FieldContent>
                <Select
                  value={roster.departmentPatterns[department] ?? roster.patterns[0]?.id}
                  onValueChange={(value) =>
                    setRoster((prev) => ({
                      ...prev,
                      departmentPatterns: { ...prev.departmentPatterns, [department]: value },
                    }))
                  }
                >
                  <SelectTrigger id={`dept-${department}`} size="sm" className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roster.patterns.map((pattern) => (
                      <SelectItem key={pattern.id} value={pattern.id}>
                        {pattern.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Shift rotation</CardTitle>
            <CardDescription>The cycle advances one step per ISO week.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field orientation="horizontal">
              <Switch
                id="rotation-enabled"
                checked={roster.rotation.enabled}
                onCheckedChange={(checked) =>
                  setRoster((prev) => ({ ...prev, rotation: { ...prev.rotation, enabled: checked } }))
                }
              />
              <FieldContent>
                <FieldLabel htmlFor="rotation-enabled">Rotate weekly</FieldLabel>
                <FieldDescription>Off: everyone keeps their default shift.</FieldDescription>
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="rotation-dept">Rotating department</FieldLabel>
              <Select
                value={roster.rotation.department}
                onValueChange={(value) =>
                  setRoster((prev) => ({ ...prev, rotation: { ...prev.rotation, department: value } }))
                }
              >
                <SelectTrigger id="rotation-dept">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map((department) => (
                    <SelectItem key={department} value={department}>
                      {department}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>Cycle</FieldLabel>
              <ToggleGroup
                type="multiple"
                variant="outline"
                size="sm"
                value={roster.rotation.cycle}
                onValueChange={(values) =>
                  setRoster((prev) => ({
                    ...prev,
                    rotation: {
                      ...prev.rotation,
                      // Preserve shift order, not click order, so the cycle is stable.
                      cycle: prev.shifts
                        .map((shift) => shift.id)
                        .filter((shiftId) => values.includes(shiftId)),
                    },
                  }))
                }
                aria-label="Shifts in the rotation cycle"
              >
                {roster.shifts.map((shift) => (
                  <ToggleGroupItem key={shift.id} value={shift.id}>
                    {shift.name}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <FieldDescription>
                {roster.rotation.cycle.length > 0
                  ? roster.rotation.cycle
                      .map(
                        (shiftId) =>
                          roster.shifts.find((shift) => shift.id === shiftId)?.name ?? shiftId
                      )
                      .join(" → ")
                  : "Pick at least one shift."}
              </FieldDescription>
            </Field>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
