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
 *
 * The More sheet follows the apple-design skill: it tracks the finger 1:1
 * from the grab point, rubber-bands upward, projects release momentum to
 * decide dismiss-vs-return, and settles on a critically damped spring that
 * inherits the finger's velocity — grabbable again at any instant.
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

export function resolvePins(saved: string[] | null, permitted: NavItem[]): NavItem[] {
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

/** Apple's momentum projection (exponential decay), d ≈ 0.998. */
const project = (velocity: number, decelerationRate = 0.998) =>
  ((velocity / 1000) * decelerationRate) / (1 - decelerationRate)

/** Progressive resistance past a boundary — real things slow before they stop. */
const rubberband = (overshoot: number, dimension: number, constant = 0.55) =>
  (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * Drag-to-dismiss on the sheet. DOM transforms via rAF, never React state —
 * the presentation value IS the source of truth, so an interrupt grabs the
 * sheet exactly where it is on screen (§3 of the skill).
 */
function useSheetDrag(onDismiss: () => void) {
  const sheetRef = React.useRef<HTMLDivElement | null>(null)
  const state = React.useRef({
    y: 0,
    grabbedAtPointer: 0,
    grabbedAtY: 0,
    history: [] as Array<{ y: number; t: number }>,
    raf: 0,
    velocity: 0,
  })

  const setY = (y: number) => {
    state.current.y = y
    const el = sheetRef.current
    if (el) el.style.transform = y === 0 ? "" : `translate3d(0, ${y}px, 0)`
  }

  const stopSpring = () => {
    if (state.current.raf) cancelAnimationFrame(state.current.raf)
    state.current.raf = 0
  }

  /** Critically damped spring (damping 1.0, response ≈ 0.35s), velocity handed off. */
  const springTo = (target: number, initialVelocity: number, done?: () => void) => {
    stopSpring()
    const omega = (2 * Math.PI) / 0.35
    let position = state.current.y
    let velocity = initialVelocity
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30)
      last = now
      // Semi-implicit Euler on x'' = −ω²(x−target) − 2ωx'
      const acceleration = -omega * omega * (position - target) - 2 * omega * velocity
      velocity += acceleration * dt
      position += velocity * dt
      state.current.velocity = velocity
      if (Math.abs(position - target) < 0.5 && Math.abs(velocity) < 20) {
        setY(target)
        state.current.raf = 0
        done?.()
        return
      }
      setY(position)
      state.current.raf = requestAnimationFrame(tick)
    }
    state.current.raf = requestAnimationFrame(tick)
  }

  const onPointerDown = (event: React.PointerEvent) => {
    if (prefersReducedMotion()) return
    // Grab wherever it is, even mid-spring — motion is always interruptible.
    stopSpring()
    event.currentTarget.setPointerCapture(event.pointerId)
    state.current.grabbedAtPointer = event.clientY
    state.current.grabbedAtY = state.current.y
    state.current.history = [{ y: event.clientY, t: performance.now() }]
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const raw = state.current.grabbedAtY + (event.clientY - state.current.grabbedAtPointer)
    const height = sheetRef.current?.getBoundingClientRect().height ?? 400
    // Downward follows 1:1; upward resists — there's nothing more up there.
    setY(raw >= 0 ? raw : rubberband(raw, height))
    const now = performance.now()
    state.current.history = [
      ...state.current.history.filter((entry) => now - entry.t < 100),
      { y: event.clientY, t: now },
    ]
  }

  const onPointerUp = (event: React.PointerEvent) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    const history = state.current.history
    const oldest = history[0]
    const newest = history[history.length - 1]
    const elapsed = newest && oldest ? newest.t - oldest.t : 0
    const velocity = elapsed > 0 ? ((newest.y - oldest.y) / elapsed) * 1000 : 0

    const height = sheetRef.current?.getBoundingClientRect().height ?? 400
    // Decide from where the gesture is GOING, not where it stopped.
    const projected = state.current.y + project(velocity)
    if (projected > height * 0.4 || velocity > 900) {
      springTo(height, velocity, () => {
        onDismiss()
        setY(0)
      })
    } else {
      springTo(0, velocity)
    }
  }

  const resetOnOpen = () => {
    stopSpring()
    setY(0)
  }

  return { sheetRef, onPointerDown, onPointerMove, onPointerUp, resetOnOpen }
}

export function BottomNav() {
  const { pathname } = useLocation()
  const { bottomNav } = useAppConfig()
  const permitted = usePermittedNavItems()
  const [moreOpen, setMoreOpen] = React.useState(false)
  const drag = useSheetDrag(() => setMoreOpen(false))

  const pins = resolvePins(bottomNav, permitted)
  const isActive = (url: string) =>
    url === "/" ? pathname === "/" : pathname === url || pathname.startsWith(`${url}/`)
  const activeInMore = !pins.some((item) => isActive(item.url))

  // Feedback lives on the press, and it's instant (§1).
  const pressClass =
    "transition-transform duration-100 ease-out active:scale-95 active:duration-100"

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
                pressClass,
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
              pressClass,
              activeInMore ? "text-primary" : "text-muted-foreground"
            )}
          >
            <LayoutGrid className={cn("size-5", activeInMore && "stroke-[2.25]")} />
            More
          </button>
        </div>
      </nav>

      <Sheet
        open={moreOpen}
        onOpenChange={(open) => {
          setMoreOpen(open)
          if (open) drag.resetOnOpen()
        }}
      >
        <SheetContent
          ref={drag.sheetRef}
          side="bottom"
          className="max-h-[80svh] overflow-y-auto rounded-t-xl pb-[env(safe-area-inset-bottom)] will-change-transform"
        >
          {/* The grab handle: 1:1 tracking from wherever the finger lands. */}
          <div
            className="flex cursor-grab justify-center pt-2.5 pb-1 [touch-action:none] active:cursor-grabbing"
            onPointerDown={drag.onPointerDown}
            onPointerMove={drag.onPointerMove}
            onPointerUp={drag.onPointerUp}
            onPointerCancel={drag.onPointerUp}
          >
            <div className="bg-muted-foreground/30 h-1.5 w-10 rounded-full" />
          </div>
          <SheetHeader className="pt-0 pb-0">
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
                          pressClass,
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
