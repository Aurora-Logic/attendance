/**
 * `YYYY-MM-DD` for an instant in a zone. `Intl` rather than offset
 * arithmetic — India is +05:30 and half-hour offsets are exactly where
 * hand-rolled conversion goes wrong. The attendance module has its own copy
 * inside the day engine; the platform cannot import it (technical design §1)
 * and eight lines is cheaper than a shared package for one function.
 */
export function localDateIn(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}
