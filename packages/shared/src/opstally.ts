import { z } from 'zod';

/**
 * The OpsTally webhook contract, v1 (the "OpsTally Webhooks" reference).
 *
 * OpsTally Agent runs beside TallyPrime and pushes signed JSON events —
 * stock, ledgers, vouchers — to an HTTPS endpoint Vyuha exposes. This file
 * is that contract as Vyuha reads it, field for field from the reference, so
 * that a delivery either validates against exactly what the document
 * promises or is refused for a named reason. Nothing here is Vyuha's own
 * shape: the mapping onto Vyuha's projections lives in the API.
 *
 * Numbers arrive as JSON numbers, not decimal strings — that is OpsTally's
 * choice, recorded here as `z.number()`. They are held, never computed on
 * (D-01); the API stores them into `numeric` columns as they arrived.
 */

/** Header names, exactly as OpsTally sends them. */
export const OPSTALLY_HEADERS = {
  SIGNATURE: 'x-tally-signature',
  EVENT: 'x-tally-event',
  EVENT_ID: 'x-tally-event-id',
} as const;

/** The webhook signing secret's prefix; the reference guarantees it. */
export const OPSTALLY_SECRET_PREFIX = 'whsec_';

export const OPSTALLY_EVENTS = [
  'ping',
  'stock.updated',
  'stock.snapshot',
  'ledger.created',
  'ledger.updated',
  'voucher.created',
  'voucher.updated',
  'voucher.cancelled',
] as const;

export type OpsTallyEventType = (typeof OPSTALLY_EVENTS)[number];

/** Tally's own formatted numbers can be large; the guard is against NaN/Infinity, not size. */
const money = z.number().finite();

/** "Tally's internal numeric id" — documented as string, tolerated as number. */
const masterId = z.union([z.string(), z.number()]).transform((value) => String(value));

export const opsTallyStockItemSchema = z.object({
  guid: z.string().min(1).max(120),
  masterId,
  alterId: z.number().int().min(0),
  name: z.string().min(1).max(200),
  /** Stock group this item belongs to. */
  parent: z.string().max(120).default(''),
  /** Unit of measure — NOS, PCS, KG. */
  baseUnits: z.string().max(40).default(''),
  closingQty: money.default(0),
  closingRate: money.default(0),
  closingValue: money.default(0),
  /** 0 means "no source could resolve it", never "free" (reference §12). */
  salePrice: money.default(0),
  costPrice: money.default(0),
});

export type OpsTallyStockItem = z.infer<typeof opsTallyStockItemSchema>;

export const opsTallyLedgerSchema = z.object({
  guid: z.string().min(1).max(120),
  masterId,
  alterId: z.number().int().min(0),
  name: z.string().min(1).max(200),
  /** Ledger group — Sundry Debtors, Sundry Creditors, Bank Accounts, … */
  parent: z.string().max(120).default(''),
  /** "GSTIN on file for this ledger, when set." */
  gstin: z.string().max(20).nullable().optional(),
});

export type OpsTallyLedger = z.infer<typeof opsTallyLedgerSchema>;

export const opsTallyLedgerEntrySchema = z.object({
  ledgerName: z.string().max(200),
  amount: money,
  /** Tally's debit/credit convention — true on the debit side. */
  isDeemedPositive: z.boolean(),
});

export const opsTallyInventoryEntrySchema = z.object({
  stockItemName: z.string().max(200),
  /** Tally's own formatted string, may carry a unit suffix. */
  actualQty: z.union([z.string(), z.number()]).transform((value) => String(value)),
  billedQty: z.union([z.string(), z.number()]).transform((value) => String(value)),
  rate: money,
  amount: money,
});

export const opsTallyVoucherSchema = z.object({
  guid: z.string().min(1).max(120),
  masterId,
  alterId: z.number().int().min(0),
  /** Tally's native YYYYMMDD. */
  date: z.string().regex(/^\d{8}$/u),
  /** Configurable per company — free text. */
  voucherType: z.string().max(120),
  voucherNumber: z.string().max(120).default(''),
  party: z.string().max(200).default(''),
  narration: z.string().max(4000).default(''),
  isCancelled: z.boolean(),
  amount: money,
  ledgerEntries: z.array(opsTallyLedgerEntrySchema).default([]),
  inventoryEntries: z.array(opsTallyInventoryEntrySchema).default([]),
});

export type OpsTallyVoucher = z.infer<typeof opsTallyVoucherSchema>;

/**
 * Every delivery: the same five envelope fields; only `payload` varies. A
 * discriminated union on `event`, so a `stock.updated` carrying a ledger
 * body fails at the door with the field named, instead of reaching a writer.
 */
const envelope = {
  /** Unique event id, prefixed evt_ — the idempotency key. */
  id: z.string().min(1).max(120),
  created_at: z.string().min(1),
  /** Exact Tally company name this data came from. */
  company: z.string().min(1).max(200),
  /** Stable per Agent installation, minted once on first run. */
  install_id: z.string().min(1).max(120),
} as const;

export const opsTallyEventSchema = z.discriminatedUnion('event', [
  z.object({ ...envelope, event: z.literal('ping'), payload: z.object({ message: z.string().default('') }) }),
  z.object({ ...envelope, event: z.literal('stock.updated'), payload: opsTallyStockItemSchema }),
  z.object({
    ...envelope,
    event: z.literal('stock.snapshot'),
    payload: z.object({
      items: z.array(opsTallyStockItemSchema).max(500),
      chunk: z.number().int().min(1),
      total_chunks: z.number().int().min(1),
    }),
  }),
  z.object({ ...envelope, event: z.literal('ledger.created'), payload: opsTallyLedgerSchema }),
  z.object({ ...envelope, event: z.literal('ledger.updated'), payload: opsTallyLedgerSchema }),
  z.object({ ...envelope, event: z.literal('voucher.created'), payload: opsTallyVoucherSchema }),
  z.object({ ...envelope, event: z.literal('voucher.updated'), payload: opsTallyVoucherSchema }),
  z.object({ ...envelope, event: z.literal('voucher.cancelled'), payload: opsTallyVoucherSchema }),
]);

export type OpsTallyEvent = z.infer<typeof opsTallyEventSchema>;

/** What Vyuha answers. Only the status matters to the Agent; the body is for people. */
export interface OpsTallyAck {
  readonly ok: true;
  readonly eventId: string;
  /** True when this id had already been accepted — the retry was a no-op. */
  readonly duplicate: boolean;
  /** What Vyuha did with it, in one line, for the journal and for a person reading the reply. */
  readonly result: string;
}

/** The admin's half: paste the whsec_ secret OpsTally generated. */
export const setWebhookSecretSchema = z.object({
  secret: z.string().trim().startsWith(OPSTALLY_SECRET_PREFIX).min(16).max(256),
});

export type SetWebhookSecretInput = z.infer<typeof setWebhookSecretSchema>;
