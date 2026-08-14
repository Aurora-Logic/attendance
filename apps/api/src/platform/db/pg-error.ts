/**
 * Postgres tells us things the application cannot know any other way, and the
 * unique index is the clearest case: a pre-flight "is this code taken?" query
 * answers for the instant it ran, and two requests can both be told no.
 *
 * The constraint is what actually decides, so the code it raises has to be
 * readable rather than reaching the client as a 500.
 */

/** `unique_violation`, from the Postgres error code table (class 23). */
const UNIQUE_VIOLATION = '23505';

/** How far to follow `cause`; guards against a chain that loops back. */
const MAX_DEPTH = 4;

/** The Postgres error code, from wherever in the `cause` chain it sits. */
function errorCode(value: unknown): string | null {
  return followCause(value, (current) =>
    'code' in current && typeof current.code === 'string' ? current.code : null,
  );
}

export function isUniqueViolation(error: unknown): boolean {
  return errorCode(error) === UNIQUE_VIOLATION;
}

/**
 * The name of the index a unique violation collided with, or null.
 *
 * A table with two unique indexes needs this: `users` has one on the email and
 * one on the employee link, and reporting the second as the first would tell
 * an administrator to look at the wrong field. Postgres puts the name in
 * `constraint`, and it survives the same `cause` chain the code does.
 */
export function uniqueViolationConstraint(error: unknown): string | null {
  if (!isUniqueViolation(error)) return null;
  return followCause(error, (current) =>
    'constraint' in current && typeof current.constraint === 'string' ? current.constraint : null,
  );
}

/**
 * Walks the `cause` chain looking for a property, because Drizzle wraps a
 * driver failure in an error whose message is the SQL and puts the real one in
 * `cause` -- matching `describeError`, which exists for the same reason.
 */
function followCause(value: unknown, read: (current: object) => string | null): string | null {
  let current: unknown = value;
  for (let depth = 0; depth <= MAX_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) return null;
    const found = read(current);
    if (found !== null) return found;
    if (!(current instanceof Error)) return null;
    current = current.cause;
  }
  return null;
}
