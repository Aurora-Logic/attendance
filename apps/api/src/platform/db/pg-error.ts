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

/**
 * Drizzle wraps a driver failure in an error whose message is the SQL and puts
 * the real one in `cause`, so the code is never on the error that was thrown --
 * matching `describeError`, which exists for the same reason.
 */
function errorCode(value: unknown): string | null {
  let current: unknown = value;
  for (let depth = 0; depth <= MAX_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) return null;
    if ('code' in current && typeof current.code === 'string') return current.code;
    if (!(current instanceof Error)) return null;
    current = current.cause;
  }
  return null;
}

export function isUniqueViolation(error: unknown): boolean {
  return errorCode(error) === UNIQUE_VIOLATION;
}
