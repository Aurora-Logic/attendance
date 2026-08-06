import { toast } from "sonner"
import { RotateCcw, Smartphone } from "lucide-react"

import { cn } from "@/lib/utils"
import { useAppConfig } from "@/lib/app-config"
import {
  DEFAULT_BOTTOM_NAV,
  resolvePins,
  usePermittedNavItems,
} from "@/components/bottom-nav"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"

/**
 * Settings → Navigation: pick the four screens pinned to the phone's bottom
 * bar. A personal preference, stored on this device — everything unpinned
 * stays one tap away in the More sheet, so nothing is ever unreachable.
 */
export function MobileNavSettings() {
  const { bottomNav, setBottomNav } = useAppConfig()
  const permitted = usePermittedNavItems()
  const pins = resolvePins(bottomNav, permitted)
  const pinnedUrls = pins.map((item) => item.url)

  const toggle = (url: string) => {
    if (pinnedUrls.includes(url)) {
      setBottomNav(pinnedUrls.filter((candidate) => candidate !== url))
    } else if (pinnedUrls.length >= 4) {
      toast.error("Four pins fit the bar — unpin one first.")
    } else {
      setBottomNav([...pinnedUrls, url])
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader>
          <CardTitle>Bottom bar pins</CardTitle>
          <CardDescription>
            Four screens live on the phone's bottom bar; the rest sit in More. Order follows
            your selection. Stored on this device only.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {permitted.map((item) => {
              const pinned = pinnedUrls.includes(item.url)
              const position = pinnedUrls.indexOf(item.url)
              return (
                <label
                  key={item.url}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2",
                    pinned && "border-primary/40 bg-primary/5"
                  )}
                >
                  <Checkbox
                    checked={pinned}
                    onCheckedChange={() => toggle(item.url)}
                    aria-label={`Pin ${item.title}`}
                  />
                  <item.icon className="text-muted-foreground size-4" />
                  <span className="flex-1 text-sm">{item.title}</span>
                  {pinned ? <Badge variant="secondary">#{position + 1}</Badge> : null}
                </label>
              )
            })}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => {
              setBottomNav(null)
              toast("Bottom bar reset to the default pins")
            }}
          >
            <RotateCcw />
            Reset to default
          </Button>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="size-4" />
            Preview
          </CardTitle>
          <CardDescription>How the bar renders on a phone</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-background grid h-16 auto-cols-fr grid-flow-col rounded-lg border">
            {pins.map((item, index) => (
              <div
                key={item.url}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 text-[10px] font-medium",
                  index === 0 ? "text-primary" : "text-muted-foreground"
                )}
              >
                <item.icon className="size-5" />
                <span className="max-w-full truncate px-1">{item.title}</span>
              </div>
            ))}
            <div className="text-muted-foreground flex flex-col items-center justify-center gap-1 text-[10px] font-medium">
              <Smartphone className="size-5" />
              More
            </div>
          </div>
          {!bottomNav ? (
            <p className="text-muted-foreground mt-2 text-xs">
              Currently the default set ({DEFAULT_BOTTOM_NAV.length} pins), filtered to what your
              role can see.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
