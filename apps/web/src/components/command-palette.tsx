import * as React from "react"
import { useNavigate } from "react-router"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { NAV_GROUPS, canSeeNavItem } from "@/lib/nav"
import { useSession } from "@/lib/session"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"

interface PaletteContext {
  open: boolean
  setOpen: (open: boolean) => void
}

const Context = React.createContext<PaletteContext | null>(null)

export function useCommandPalette() {
  const context = React.useContext(Context)
  if (!context) throw new Error("useCommandPalette must be used inside CommandPaletteProvider")
  return context
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const navigate = useNavigate()
  const { setTheme } = useTheme()
  const session = useSession()

  /**
   * ⌘K / Ctrl-K anywhere, plus "/" as a no-modifier fallback.
   *
   * Registered on `window` in the **capture** phase: Chrome treats ⌘K as an
   * omnibox accelerator, and Radix's dialog/menu layers call
   * stopPropagation on keydown, so a bubble-phase listener on `document`
   * never sees the event when a menu or sheet happens to be open. Capture
   * runs before any of them.
   *
   * `event.code === "KeyK"` is checked alongside `event.key` because on some
   * keyboard layouts a modified key reports a different `key` value while the
   * physical code stays stable.
   */
  React.useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null
      if (!element) return false
      const tag = element.tagName
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        element.isContentEditable
      )
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const isK = event.key?.toLowerCase() === "k" || event.code === "KeyK"
      if (isK && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        event.stopPropagation()
        setOpen((prev) => !prev)
        return
      }
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !isTypingTarget(event.target)) {
        event.preventDefault()
        setOpen(true)
      }
    }

    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [])

  const run = React.useCallback((action: () => void) => {
    setOpen(false)
    action()
  }, [])

  const value = React.useMemo(() => ({ open, setOpen }), [open])

  return (
    <Context.Provider value={value}>
      {children}
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Command palette"
        description="Jump to a screen or run an action"
      >
        <CommandInput placeholder="Search screens and actions…" />
        <CommandList>
          <CommandEmpty>No match.</CommandEmpty>
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter(
              (item) => canSeeNavItem(session, item)
            )
            if (items.length === 0) return null
            return (
              <CommandGroup key={group.label} heading={group.label}>
                {items.map((item) => (
                  <CommandItem
                    key={item.url}
                    value={`${group.label} ${item.title}`}
                    onSelect={() => run(() => navigate(item.url))}
                  >
                    <item.icon />
                    {item.title}
                  </CommandItem>
                ))}
              </CommandGroup>
            )
          })}
          <CommandSeparator />
          <CommandGroup heading="Theme">
            <CommandItem value="light theme" onSelect={() => run(() => setTheme("light"))}>
              <Sun />
              Light
            </CommandItem>
            <CommandItem value="dark theme" onSelect={() => run(() => setTheme("dark"))}>
              <Moon />
              Dark
              <CommandShortcut>⌘K</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </Context.Provider>
  )
}
