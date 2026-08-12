import { BarricadeIcon } from '@phosphor-icons/react';
import { useLocation } from 'react-router';

import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { findNavItem } from '@/lib/nav';

/**
 * Every route in the navigation resolves to something. A dead link reads as a
 * bug; this reads as a plan, and names the phase and the REQ IDs the screen
 * will implement so the delivery plan stays visible in the product.
 */
export function PlaceholderPage() {
  const location = useLocation();
  const item = findNavItem(location.pathname);

  return (
    <>
      <PageHeader action={item ? <Badge variant="secondary">Phase {item.phase}</Badge> : null} />

      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BarricadeIcon />
          </EmptyMedia>
          <EmptyTitle>Not built yet</EmptyTitle>
          <EmptyDescription>
            {item
              ? `This screen ships in Phase ${String(item.phase)} and implements ${item.reqs}.`
              : 'There is no screen at this address.'}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </>
  );
}
