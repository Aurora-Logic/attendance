import * as React from "react"
import { Link, useLocation } from "react-router"
import { LayoutGrid, Settings2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { NAV_GROUPS, type NavItem } from "@/lib/nav"
import { useAppConfig } from "@/lib/app-config"
import { useSession } from "@/lib/session"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

/**
 * Phone-only bottom navigation: four pinned destinations plus More. The pins
 * are personal (Settings → Navigation); everything else lives one tap away in
 * the More sheet, grouped exactly like the sidebar. Both respect `can()` — a
 * pinned item the role can't see silently drops out, same rule as the sidebar.
 */

/** First-choice pins when the user hasn't customised: daily-use screens. */
export const DEFAULT_BOTTOM_NAV = ["/", "/punch", "/attendance", "/approvals"]

export function usePermittedNavItems(): NavItem[] {
  const { can } = useSession()
  return React.useMemo(
    () =>
      NAV_GROUPS.flatMap((group) => group.items).filter(
        (item) => !item.permission || can(item.permission)
      ),
    [can]
  )
}

export function resolvePins(
  saved: string[] | null,
  permitted: NavItem[]
): NavItem[] {
  const wanted = saved ?? DEFAULT_BOTTOM_NAV
  const pins = wanted
    .map((url) => permitted.find((item) => item.url === url))
    .filter((item): item is NavItem => Boolean(item))
    .slice(0, 4)
  // A role with few grants still gets a useful bar.
  for (const item of permitted) {
    if (pins.length >= 4) break
    if (!pins.includes(item)) pins.push(item)
  }
  return pins
}

export function BottomNav() {
  const { pathname } = useLocation()
  const { bottomNav } = useAppConfig()
  const permitted = usePermittedNavItems()
  const [moreOpen, setMoreOpen] = React.useState(false)

  const pins = resolvePins(bottomNav, permitted)
  const isActive = (url: string) =>
    url === "/" ? pathname === "/" : pathname === url || pathname.startsWith(`${url}/`)
  const activeInMore = !pins.some((item) => isActive(item.url))

  return (
    <>
      <nav
        aria-label="Primary"
        className="bg-background/95 supports-[backdrop-filter]:bg-background/80 fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden print:hidden"
      >
        <div className="grid h-16 auto-cols-fr grid-flow-col">
          {pins.map((item) => (
            <Link
              key={item.url}
              to={item.url}
              aria-current={isActive(item.url) ? "page" : undefined}
              className={cn(
                "flex flex-col items-center justify-center gap-1 text-[10px] font-medium",
                isActive(item.url) ? "text-primary" : "text-muted-foreground"
              )}
            >
              <item.icon className={cn("size-5", isActive(item.url) && "stroke-[2.25]")} />
              <span className="max-w-full truncate px-1">{item.title}</span>
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-expanded={moreOpen}
            className={cn(
              "flex flex-col items-center justify-center gap-1 text-[10px] font-medium",
              activeInMore ? "text-primary" : "text-muted-foreground"
            )}
          >
            <LayoutGrid className={cn("size-5", activeInMore && "stroke-[2.25]")} />
            More
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="max-h-[80svh] overflow-y-auto rounded-t-xl pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="pb-0">
            <SheetTitle>All screens</SheetTitle>
            <SheetDescription>Pin your four most-used in Settings → Navigation.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 p-4">
            {NAV_GROUPS.map((group) => {
              const items = group.items.filter((item) => permitted.includes(item))
              if (items.length === 0) return null
              return (
                <div key={group.label}>
                  <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {items.map((item) => (
                      <Link
                        key={item.url}
                        to={item.url}
                        onClick={() => setMoreOpen(false)}
                        className={cn(
                          "flex flex-col items-center gap-1.5 rounded-lg border p-2.5 text-center text-[10px] leading-tight font-medium",
                          isActive(item.url)
                            ? "border-primary/40 bg-primary/5 text-primary"
                            : "text-muted-foreground active:bg-muted"
                        )}
                      >
                        <item.icon className="size-5" />
                        {item.title}
                      </Link>
                    ))}
                  </div>
                </div>
              )
            })}
            <Button variant="outline" size="sm" asChild className="w-full">
              <Link to="/settings" onClick={() => setMoreOpen(false)}>
                <Settings2 />
                Customise this bar
              </Link>
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
