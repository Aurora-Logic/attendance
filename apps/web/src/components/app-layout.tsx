import * as React from "react"
import { Outlet, useLocation } from "react-router"
import { Search } from "lucide-react"

import { AppSidebar } from "@/components/app-sidebar"
import { BottomNav } from "@/components/bottom-nav"
import { NotificationBell } from "@/components/notification-bell"
import { CommandPaletteProvider, useCommandPalette } from "@/components/command-palette"
import { ModeToggle } from "@/components/mode-toggle"
import { resolveCrumbs } from "@/lib/nav"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Calculator } from "@/components/calculator"

/**
 * The calculator lives at the shell so it floats over whichever screen is open
 * (5.6). `Alt+C` is Tally's own second calculator key — Tally's first is
 * Ctrl+N, which a browser will not surrender, and 6.6 says to use the native
 * alternative rather than invent one.
 */
function CalculatorHost() {
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key.toLowerCase() !== "c") return
      event.preventDefault()
      setOpen((current) => !current)
    }
    // Capture phase: an input with its own Alt handling must not swallow it.
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [])

  return <Calculator open={open} onClose={() => setOpen(false)} />
}

function useCrumbs() {
  const { pathname } = useLocation()
  return resolveCrumbs(pathname)
}

function SearchTrigger() {
  const { setOpen } = useCommandPalette()
  return (
    <Button
      variant="outline"
      size="sm"
      className="text-muted-foreground gap-2"
      // The label is visually hidden below sm, leaving an icon-only button
      // with no accessible name — unusable with a screen reader and
      // unaddressable in a test.
      aria-label="Search"
      onClick={() => setOpen(true)}
    >
      <Search />
      <span className="hidden sm:inline">Search</span>
      <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
    </Button>
  )
}

function Shell() {
  const { group, page } = useCrumbs()

  return (
    <SidebarInset className="flex h-svh min-h-0 flex-col overflow-hidden">
      <header className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b px-3 backdrop-blur sm:px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-1 h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            {group ? (
              <>
                <BreadcrumbItem className="hidden md:block">
                  <span className="text-muted-foreground">{group}</span>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
              </>
            ) : null}
            <BreadcrumbItem>
              <BreadcrumbPage className="truncate">{page}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="ml-auto flex items-center gap-2">
          <SearchTrigger />
          <NotificationBell />
          <ModeToggle />
        </div>
      </header>

      {/* Reserve the bottom-nav's height on phones so pages never hide under it. */}
      <div className="min-h-0 flex-1 overflow-hidden max-md:pb-16">
        <Outlet />
      </div>
      <BottomNav />
    </SidebarInset>
  )
}

export function AppLayout() {
  // Tablet-width laptops and iPads in either orientation start with the rail
  // collapsed: 256px of nav out of 820px of screen is a third of the window
  // spent on wayfinding the user already knows. The trigger reopens it, and
  // the choice persists — this is only the first-visit default.
  const defaultOpen =
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 1152px)").matches

  return (
    <TooltipProvider>
      {/*
        The shell is exactly one viewport tall and never scrolls. Header and
        sidebar are structurally fixed; each page owns its own scroll region.
      */}
      <SidebarProvider defaultOpen={defaultOpen} className="h-svh overflow-hidden">
        <CommandPaletteProvider>
          <AppSidebar />
          <Shell />
          <CalculatorHost />
        </CommandPaletteProvider>
        <Toaster />
      </SidebarProvider>
    </TooltipProvider>
  )
}
