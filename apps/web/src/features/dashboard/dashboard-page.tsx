import { DatabaseZap } from 'lucide-react';
import { Link } from 'react-router';

import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

/**
 * REQ-K-01 role-aware dashboard. The tiles arrive in Phase 4, and the data
 * behind them in Phase 1, so this deliberately shows an empty state rather
 * than placeholder numbers — a dashboard that invents figures is worse than
 * one that admits it has none (CLAUDE.md §6).
 */
export function DashboardPage() {
  return (
    <>
      <PageHeader
        description="Today's attendance at a glance."
        crumbs={[{ label: 'Work' }, { label: 'Dashboard' }]}
      />

      <Empty className="rounded-lg border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <DatabaseZap />
          </EmptyMedia>
          <EmptyTitle>Nothing to show yet</EmptyTitle>
          <EmptyDescription>
            The dashboard reports on attendance days, which the punch engine produces in Phase 1.
            No API is connected, so there is no data to summarise.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {/* nativeButton={false} because the rendered element is an anchor.
              Base UI errors otherwise, and it is right to: a link that claims
              button semantics breaks keyboard and screen-reader behaviour. */}
          <Button variant="outline" nativeButton={false} render={<Link to="/patterns" />}>
            See the shell patterns
          </Button>
        </EmptyContent>
      </Empty>
    </>
  );
}
