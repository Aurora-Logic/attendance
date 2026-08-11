/**
 * UUID v7 (RFC 9562). Time-ordered, so primary keys cluster by insertion time
 * and index locality on append-heavy tables like `punches` and `audit_logs`
 * stays good — which a random v4 would not give us.
 *
 * Postgres 16 has no built-in v7 (that arrives in 18), so the database gets an
 * equivalent SQL function as a column default. This implementation is for
 * client-generated values: idempotency keys, offline punch queue entries, and
 * tests.
 *
 * Layout: 48-bit big-endian milliseconds, 4-bit version, 12 bits random,
 * 2-bit variant, 62 bits random.
 */

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function uuidv7(nowMs: number = Date.now()): string {
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    throw new RangeError(`uuidv7 requires a non-negative epoch millisecond value, got ${nowMs}`);
  }

  const bytes = new Uint8Array(16);
  const ts = BigInt(Math.floor(nowMs));

  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);

  crypto.getRandomValues(bytes.subarray(6));

  // Version 7 in the high nibble of byte 6.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  // RFC 9562 variant (10xx) in the high bits of byte 8.
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const h = (i: number): string => HEX[bytes[i] ?? 0] ?? '00';

  return (
    h(0) + h(1) + h(2) + h(3) + '-' +
    h(4) + h(5) + '-' +
    h(6) + h(7) + '-' +
    h(8) + h(9) + '-' +
    h(10) + h(11) + h(12) + h(13) + h(14) + h(15)
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Milliseconds encoded in a v7 UUID, or null if it is not a v7. */
export function uuidv7Timestamp(uuid: string): number | null {
  if (!isUuid(uuid) || uuid[14] !== '7') return null;
  return Number.parseInt(uuid.slice(0, 8) + uuid.slice(9, 13), 16);
}
