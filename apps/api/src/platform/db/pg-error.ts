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

/**
 * `check_violation`, same table. A CHECK constraint is a business rule the
 * database keeps when two requests race or a screen is stale -- "a line packs
 * only what it has picked". Reaching the client as a 500 (owner, 22 Aug 2026:
 * "Packing failed. Something went wrong on our side") told the person the
 * product was broken when the data was simply ahead of the screen.
 */
const CHECK_VIOLATION = '23514';

/**
 * What each constraint means, in the words the module that owns it chose.
 * The platform cannot know a sales rule, so the module registers the sentence
 * at load and the exception filter looks it up by the constraint's name.
 */
const CONSTRAINT_MESSAGES = new Map<string, string>();

export function describeConstraint(name: string, message: string): void {
  CONSTRAINT_MESSAGES.set(name, message);
}

export function constraintMessage(name: string): string | null {
  return CONSTRAINT_MESSAGES.get(name) ?? null;
}

/**
 * node-postgres raises this exact `Error` from `Pool._pulseQueue` when
 * `connectionTimeoutMillis` elapses with no free client. It carries no SQLSTATE
 * -- Postgres was never reached -- so the message is the only signal there is.
 *
 * Matched rather than inferred from timing because the distinction is the whole
 * point: the pool being saturated is transient and the caller should retry, and
 * everything else that reaches the exception filter unrecognised is a bug the
 * caller cannot do anything about.
 */
const POOL_CONNECT_TIMEOUT = 'timeout exceeded when trying to connect';

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

export function isCheckViolation(error: unknown): boolean {
  return errorCode(error) === CHECK_VIOLATION;
}

/** The CHECK constraint that refused the change, or null. */
export function checkViolationConstraint(error: unknown): string | null {
  if (!isCheckViolation(error)) return null;
  return constraintName(error);
}

/**
 * True when the pool could not hand out a connection in time.
 *
 * Measured on the production build with every one of the ten pool connections
 * blocked on a table lock: `GET /me/today` for an employee with nothing to do
 * with the contention answered `500 INTERNAL_ERROR` after 5.07s, while
 * `/ready` correctly reported `503 degraded` at the same instant. A 500 tells
 * a client to stop; this is the one database failure where trying again in a
 * moment is exactly right.
 *
 * The message is read from anywhere in the `cause` chain because Drizzle wraps
 * the driver's error in one whose own message is the SQL -- the failure
 * arrives as "Failed query: select 1 ...: timeout exceeded when trying to
 * connect".
 */
export function isPoolConnectionTimeout(error: unknown): boolean {
  return (
    followCause(error, (current) =>
      current instanceof Error && current.message.includes(POOL_CONNECT_TIMEOUT)
        ? current.message
        : null,
    ) !== null
  );
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
  return constraintName(error);
}

function constraintName(error: unknown): string | null {
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
