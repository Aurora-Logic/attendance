import { Outlet, useLocation } from "react-router"
import { Search } from "lucide-react"

import { AppSidebar } from "@/components/app-sidebar"
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
          <ModeToggle />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
    </SidebarInset>
  )
}

export function AppLayout() {
  return (
    <TooltipProvider>
      {/*
        The shell is exactly one viewport tall and never scrolls. Header and
        sidebar are structurally fixed; each page owns its own scroll region.
      */}
      <SidebarProvider className="h-svh overflow-hidden">
        <CommandPaletteProvider>
          <AppSidebar />
          <Shell />
        </CommandPaletteProvider>
        <Toaster />
      </SidebarProvider>
    </TooltipProvider>
  )
}
