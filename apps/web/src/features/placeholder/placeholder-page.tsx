import { BarricadeIcon, SignpostIcon } from '@phosphor-icons/react';
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
 * bug; a planned screen reads as a plan, and names the phase and the REQ IDs
 * it will implement so the delivery plan stays visible in the product.
 *
 * The catch-all is a different statement. An address that matches nothing in
 * the navigation is not coming in any phase, and saying "not built yet" there
 * would promise a screen that does not exist - so it says plainly that there
 * is nothing here.
 */
export function PlaceholderPage() {
  const location = useLocation();
  const item = findNavItem(location.pathname);

  if (!item) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SignpostIcon />
          </EmptyMedia>
          <EmptyTitle>No such screen</EmptyTitle>
          <EmptyDescription>
            Nothing in this product answers to {location.pathname}. Check the address, or pick a
            screen from the navigation.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <PageHeader action={<Badge variant="secondary">Phase {item.phase}</Badge>} />

      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BarricadeIcon />
          </EmptyMedia>
          <EmptyTitle>Not built yet</EmptyTitle>
          <EmptyDescription>
            {`This screen ships in Phase ${String(item.phase)} and implements ${item.reqs}.`}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </>
  );
}
