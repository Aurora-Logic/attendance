import { Link } from "react-router"
import { ShieldOff } from "lucide-react"

import { useSession } from "@/lib/session"
import { Page, PageBody, PageHeader } from "@/components/page-shell"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

/**
 * Gate a route on a capability, not just the nav entry.
 *
 * The sidebar already hid what a role cannot use, but the routes themselves
 * were open: typing /payroll as an employee rendered the full screen, whose
 * hooks then fired requests the API correctly refused. The result was a
 * working-looking page full of empty tables and a console of 403s — the exact
 * shape that makes people think the system is broken rather than that they
 * lack access.
 *
 * The API remains the authority; this only stops the client asking questions
 * it already knows the answer to.
 */
export function RequirePermission({
  permission,
  requiresFullScope = false,
  children,
}: {
  permission: string
  /** Require ALL scope, matching the nav entry's own rule. */
  requiresFullScope?: boolean
  children: React.ReactNode
}) {
  const { can, scopeFor } = useSession()
  const allowed = requiresFullScope ? scopeFor(permission) === "ALL" : can(permission)
  if (allowed) return <>{children}</>

  return (
    <Page>
      <PageHeader title="Not available to you" />
      <PageBody>
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShieldOff />
            </EmptyMedia>
            <EmptyTitle>You do not have access to this screen</EmptyTitle>
            <EmptyDescription>
              It needs the <span className="font-mono text-xs">{permission}</span> permission.
              If you think that is wrong, ask an administrator — Roles &amp; Permissions is where
              it is granted.
            </EmptyDescription>
          </EmptyHeader>
          <Button variant="outline" size="sm" asChild>
            <Link to="/">Back to your dashboard</Link>
          </Button>
        </Empty>
      </PageBody>
    </Page>
  )
}
