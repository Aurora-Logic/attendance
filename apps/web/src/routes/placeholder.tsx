import { Construction } from "lucide-react"
import { useLocation } from "react-router"

import { NAV_GROUPS } from "@/lib/nav"
import { Badge } from "@/components/ui/badge"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

/**
 * Every planned screen has a home from Phase 0, labelled with the phase that
 * delivers it. Keeps "what is stubbed" answerable by looking at the app.
 */
export function PlaceholderPage() {
  const { pathname } = useLocation()
  const item = NAV_GROUPS.flatMap((group) => group.items).find(
    (entry) => entry.url === pathname
  )

  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Construction />
        </EmptyMedia>
        <EmptyTitle>{item?.title ?? "Not found"}</EmptyTitle>
        <EmptyDescription>
          {item
            ? "Scaffolded, not yet built. The route, nav entry and layout are in place."
            : "No screen is mapped to this path."}
        </EmptyDescription>
      </EmptyHeader>
      {item ? <Badge variant="outline">Phase {item.phase}</Badge> : null}
    </Empty>
  )
}
