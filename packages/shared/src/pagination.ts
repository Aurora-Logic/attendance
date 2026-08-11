import { z } from 'zod';

/**
 * Technical design §6: page/pageSize for reports, cursor for the audit log and
 * the punch feed. Both envelopes are defined once here so every collection
 * endpoint and every table on the web side agree without a second definition.
 */

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

export const cursorQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface CursorMeta {
  nextCursor: string | null;
  hasMore: boolean;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export interface CursorPaginated<T> {
  data: T[];
  meta: CursorMeta;
}

/**
 * `?sort=-date,employeeCode` — a leading minus means descending. Parsing lives
 * here so the API and any client-side optimistic sort stay consistent.
 */
export interface SortTerm {
  field: string;
  direction: 'asc' | 'desc';
}

export function parseSort(input: string | undefined, allowedFields: readonly string[]): SortTerm[] {
  if (!input) return [];
  const terms: SortTerm[] = [];
  for (const raw of input.split(',')) {
    const token = raw.trim();
    if (!token) continue;
    const direction = token.startsWith('-') ? 'desc' : 'asc';
    const field = token.startsWith('-') ? token.slice(1) : token;
    // An unknown sort field is a client bug, not a reason to silently return
    // arbitrary ordering — the caller decides whether to 400 or ignore.
    if (!allowedFields.includes(field)) continue;
    terms.push({ field, direction });
  }
  return terms;
}
