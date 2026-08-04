import * as React from "react"
import { Check, ChevronsUpDown, CirclePlus } from "lucide-react"

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
 * Pick-or-create combobox (popover + command — the documented composition).
 * When the search text matches nothing exactly, a "Create" row appears; the
 * caller registers the new value in its master list via `onCreate`. Built for
 * the brand/category fields, where a free Input breeds typos ("Packging")
 * that silently split every report grouped on the value.
 */
export function ComboboxCreate({
  id,
  value,
  options,
  placeholder,
  searchPlaceholder,
  createLabel = "Create",
  allowClear = false,
  onChange,
  onCreate,
}: {
  id?: string
  value: string
  options: string[]
  placeholder: string
  searchPlaceholder: string
  /** Verb shown on the create row: `${createLabel} "query"`. */
  createLabel?: string
  /** Show a "None" row that clears the value (for optional fields). */
  allowClear?: boolean
  onChange: (value: string) => void
  onCreate: (value: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")

  const trimmed = query.trim()
  const exactMatch = options.some(
    (option) => option.toLowerCase() === trimmed.toLowerCase()
  )

  const pick = (next: string) => {
    onChange(next)
    setOpen(false)
    setQuery("")
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery("")
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value || placeholder}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-56 p-0" align="start">
        <Command>
          <CommandInput
            placeholder={searchPlaceholder}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>{trimmed ? "No match — create it below." : "Type to search."}</CommandEmpty>
            <CommandGroup>
              {allowClear && value ? (
                <CommandItem value="—none—" onSelect={() => pick("")}>
                  <span className="text-muted-foreground">None</span>
                </CommandItem>
              ) : null}
              {options.map((option) => (
                <CommandItem key={option} value={option} onSelect={() => pick(option)}>
                  {option}
                  <Check
                    className={cn("ml-auto", value === option ? "opacity-100" : "opacity-0")}
                  />
                </CommandItem>
              ))}
              {trimmed && !exactMatch ? (
                <CommandItem
                  value={`create:${trimmed}`}
                  forceMount
                  onSelect={() => {
                    onCreate(trimmed)
                    pick(trimmed)
                  }}
                >
                  <CirclePlus />
                  {createLabel} “{trimmed}”
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
