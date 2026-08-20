/**
 * Money in words, the Indian way (crore, lakh, thousand), for "Amount
 * chargeable (in words)" — the line every GST invoice carries and every
 * accountant reads before the figure. Rupees and paise, "Only" at the end,
 * as Tally prints it.
 */

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds] ?? ''} Hundred`);
  if (rest > 0) {
    if (rest < 20) parts.push(ONES[rest] ?? '');
    else parts.push(`${TENS[Math.floor(rest / 10)] ?? ''}${rest % 10 > 0 ? ` ${ONES[rest % 10] ?? ''}` : ''}`);
  }
  return parts.join(' ');
}

/** 4130 → "Four Thousand One Hundred Thirty"; 0 → "Zero". */
export function integerToIndianWords(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '';
  const n = Math.floor(value);
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (crore > 0) parts.push(`${integerToIndianWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${belowThousand(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${belowThousand(thousand)} Thousand`);
  if (rest > 0) parts.push(belowThousand(rest));
  return parts.join(' ');
}

/** "4130.00" → "Indian Rupee Four Thousand One Hundred Thirty Only"; "12.50" → "… Twelve and Paise Fifty Only". */
export function moneyToIndianWords(value: string, currency = 'Indian Rupee'): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  const rupees = Math.floor(Math.abs(number));
  const paise = Math.round((Math.abs(number) - rupees) * 100);
  const words = [`${currency} ${integerToIndianWords(rupees)}`];
  if (paise > 0) words.push(`and Paise ${integerToIndianWords(paise)}`);
  return `${words.join(' ')} Only`;
}
