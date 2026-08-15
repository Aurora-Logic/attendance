import { sql, type SQL } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';

/**
 * An employee's display name computed in SQL, and never null.
 *
 * The SQL twin of `employeeDisplayName` from the shared contract, which is the
 * canonical rule. Some rows are named in TypeScript after the query and some
 * have to be named inside it -- to be sorted on, searched, or read straight
 * into a one-line approval subject -- and the two must not disagree about what
 * a person is called.
 *
 * Getting it wrong in SQL is silent in a way the TypeScript version is not.
 * REQ-A-01 asks only for a first name, so `employees.last_name` is nullable,
 * and in SQL `'Asha' || ' ' || NULL` evaluates to NULL rather than to 'Asha'.
 * A repository that concatenates the two columns directly therefore renders
 * *the word "null"* as the name of every employee without a surname: no error,
 * no empty string, and nothing a type checker can see, because the expression
 * is still typed `string`.
 *
 * That is not hypothetical. `RegularizationRepository` shipped it, and it
 * reached the regularizations list, the on-duty list and the approvals inbox
 * sentence before anybody noticed.
 *
 * Four call sites had each written this expression by hand. They agreed, which
 * is the state a class of bug hides in -- the fifth is the one that forgets
 * the `coalesce`. This is that expression, once, with a test that runs it
 * against a real database and against the shared function it must match.
 *
 * Takes columns rather than a table so it serves both shapes in use: Drizzle
 * column references in a normal select, and raw aliased columns (`e.first_name`)
 * inside a correlated subquery, where no Drizzle table object is in scope.
 *
 * Lives in `platform/people` because employees are platform-owned; the
 * attendance module may import it, and never the other way round.
 */
export function employeeNameSql(
  firstName: AnyColumn | SQL,
  lastName: AnyColumn | SQL,
): SQL<string> {
  // `trim` because a null or empty surname leaves the separating space behind,
  // and the shared function returns the first name with no space at all. A
  // trailing space also sorts and compares differently from the same name
  // without one, which is a slow bug rather than a visible one.
  return sql<string>`trim(both ' ' from ${firstName} || ' ' || coalesce(${lastName}, ''))`;
}
