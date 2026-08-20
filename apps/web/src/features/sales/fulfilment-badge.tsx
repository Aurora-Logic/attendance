import { Badge } from '@/components/ui/badge';
import { FULFILMENT_STATE_LABELS, type FulfilmentState } from '@vyuha/shared';

/**
 * REQ-AA-02/AA-03: the derived word, worn beside the status. It summarises;
 * the numbers beside it (REQ-AA-29) are what count. Closed is the only state
 * that reads as done, so it is the only one filled.
 */
export function FulfilmentBadge({ state }: { state: FulfilmentState }) {
  return <Badge variant={state === 'closed' ? 'default' : state === 'short_closed' ? 'secondary' : 'outline'}>{FULFILMENT_STATE_LABELS[state]}</Badge>;
}
