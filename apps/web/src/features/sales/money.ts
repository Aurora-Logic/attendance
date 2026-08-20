import { EMPTY_VALUE } from '@/lib/format';

/** en-IN grouping (last three, then twos) for a figure that is read, never computed on. */
export function formatMoney(value: string | null): string {
  if (value === null) return EMPTY_VALUE;
  const negative = value.startsWith('-');
  const [whole = '0', fraction] = value.replace(/^-/u, '').split('.');
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest === '' ? last3 : `${rest.replace(/\B(?=(\d{2})+(?!\d))/gu, ',')},${last3}`;
  const decimals = fraction === undefined ? '00' : fraction.padEnd(2, '0').slice(0, 2);
  return `${negative ? '−' : ''}${grouped}.${decimals}`;
}
