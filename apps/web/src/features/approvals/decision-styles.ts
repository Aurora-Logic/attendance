import { FAMILY_TEXT } from '@/features/attendance/status';
import { cn } from '@/lib/utils';

/**
 * The two decisions carry their outcome in the text.
 *
 * They sit side by side and are otherwise identical, and this is the one place
 * in the product where misreading which button is which is expensive. Shared
 * between the generic approvals inbox and the leave decision band so the two
 * cannot drift.
 *
 * The colours come from the same family map the attendance statuses use, so
 * light mode gets the mixed value rather than the raw token: measured at 3.73
 * against this background, the raw success green fails AA for text this size
 * and the mix passes at 5.60.
 *
 * `hover:` has to restate the colour because the ghost variant resets text to
 * foreground on hover — the decision would lose its meaning at exactly the
 * moment the pointer is on it.
 */
export const APPROVE_CLASSES = cn(
  FAMILY_TEXT.success,
  'hover:bg-success/10 hover:text-[color-mix(in_oklch,var(--success),var(--foreground)_20%)] dark:hover:text-success',
);

export const REJECT_CLASSES = 'text-destructive hover:bg-destructive/10 hover:text-destructive';
