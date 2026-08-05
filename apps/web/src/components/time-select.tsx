import * as React from "react"
import { Check, ChevronsUpDown, Clock } from "lucide-react"
import { minutesToClock } from "@attendance/shared"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/**
 * Time picker as popover + command — the registry has no time-picker
 * component, and a native `<input type="time">` renders OS chrome that
 * matches nothing else in the app. Options come in 15-minute steps
 * (searchable, so typing "09" jumps straight there); a value off the grid —
 * e.g. an imported 09:10 shift — is kept as its own option rather than
 * silently rounded.
 */
const STEP_MIN = 15
const GRID = Array.from({ length: (24 * 60) / STEP_MIN }, (_, index) => index * STEP_MIN)

export function TimeSelect({
  value,
  onChange,
  ariaLabel,
  className,
}: {
  /** Minutes since midnight, matching ShiftSpec. */
  value: number
  onChange: (minutes: number) => void
  ariaLabel: string
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const options = GRID.includes(value) ? GRID : [...GRID, value].sort((a, b) => a - b)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={cn("justify-between font-normal tabular-nums", className)}
        >
          <Clock className="text-muted-foreground" />
          {minutesToClock(value)}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-36 p-0" align="start">
        <Command>
          <CommandInput placeholder="09:00…" />
          <CommandList>
            <CommandEmpty>No time found.</CommandEmpty>
            <CommandGroup>
              {options.map((minutes) => (
                <CommandItem
                  key={minutes}
                  value={minutesToClock(minutes)}
                  onSelect={() => {
                    onChange(minutes)
                    setOpen(false)
                  }}
                  className="tabular-nums"
                >
                  {minutesToClock(minutes)}
                  <Check
                    className={cn("ml-auto", value === minutes ? "opacity-100" : "opacity-0")}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
