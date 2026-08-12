import { Construction } from 'lucide-react';
import { useLocation } from 'react-router';

import { type Crumb, PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { findNavGroup, findNavItem } from '@/lib/nav';

/**
 * Every route in the navigation resolves to something. A dead link reads as a
 * bug; this reads as a plan, and names the phase and the REQ IDs the screen
 * will implement so the delivery plan stays visible in the product.
 */
export function PlaceholderPage() {
  const location = useLocation();
  const item = findNavItem(location.pathname);

  const title = item?.label ?? 'Not found';
  const group = findNavGroup(location.pathname);
  // "Reports" sits in a group also called Reports. A parent crumb that repeats
  // its child is the same duplication this header exists to avoid, so it is
  // dropped rather than rendered.
  const crumbs: [Crumb, ...Crumb[]] =
    group && group !== title ? [{ label: group }, { label: title }] : [{ label: title }];

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        action={item ? <Badge variant="secondary">Phase {item.phase}</Badge> : null}
      />

      <Empty className="rounded-lg border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Construction />
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
