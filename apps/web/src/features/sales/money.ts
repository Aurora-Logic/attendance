import { formatAmount } from '@/lib/format';

/** A figure that is read, never computed on, grouped the way the workspace writes numbers. */
export function formatMoney(value: string | null): string {
  return formatAmount(value);
}
