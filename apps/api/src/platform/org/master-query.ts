import { type SortTerm } from '@vyuha/shared';
import { asc, desc, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * The two things every master list does: order by a whitelisted column and
 * filter on a typed-in term. Departments, designations and locations share
 * them because they are the same list with different columns -- three copies
 * would be three chances to forget the escaping below.
 */

/**
 * The id tiebreak makes paging deterministic. Without it two rows with the
 * same name can swap places between requests, which shows up as a row that
 * appears on two pages while another never appears at all.
 */
export function masterOrderBy(
  sort: readonly SortTerm[],
  columns: Readonly<Record<string, PgColumn>>,
  fallback: PgColumn,
  id: PgColumn,
): (SQL | PgColumn)[] {
  const clauses: (SQL | PgColumn)[] = [];
  for (const term of sort) {
    const column = columns[term.field];
    if (column === undefined) continue;
    clauses.push(term.direction === 'desc' ? desc(column) : asc(column));
  }
  if (clauses.length === 0) clauses.push(asc(fallback));
  clauses.push(asc(id));
  return clauses;
}

/**
 * Case-insensitive contains, over whichever columns the caller names.
 *
 * The wildcards are escaped before the term is wrapped. Unescaped, a search
 * for `%` matches every row -- a filter that silently stops filtering, which
 * reads as working software.
 */
export function masterSearch(term: string, columns: readonly PgColumn[]): SQL {
  const pattern = `%${term.replace(/([\\%_])/gu, '\\$1')}%`;
  const branches = columns.map((column) => sql`${column} ILIKE ${pattern}`);
  return sql`(${sql.join(branches, sql` OR `)})`;
}
