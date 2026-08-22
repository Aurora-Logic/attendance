import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { statusTone } from './status-tone';

/**
 * A status pill coloured by its meaning. Pass the raw state value and the label
 * to show; the colour is chosen in one place ({@link statusTone}) so no screen
 * picks its own, and the label is always the word beside the colour.
 */
export function StatusBadge({
  state,
  label,
  className,
}: {
  state: string;
  label: string;
  className?: string;
}) {
  return (
    <Badge variant={statusTone(state)} className={cn(className)}>
      {label}
    </Badge>
  );
}
