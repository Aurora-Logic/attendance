/**
 * A boot failure an operator is meant to read, not debug.
 *
 * The sibling of `EnvValidationError`, and deliberately shaped like it: side
 * effect free so `main.ts` can import it statically, and carrying its whole
 * report in `message` so the handler prints that and nothing else. A stack
 * trace from a Redis driver names the socket, never the thing to fix.
 *
 * It exists because the alternative was measured and is much worse. Booting
 * with Redis unreachable produced a process that stayed alive for ever,
 * printed 160 bare `Error: connect ECONNREFUSED` stack traces in 25 seconds,
 * never reached `app.listen`, and held no port -- so every diagnosis started
 * from "the API is not answering" rather than from "Redis is down".
 */
export class StartupError extends Error {
  /** The single line naming what failed. */
  readonly summary: string;
  /** What to do about it. */
  readonly remedy: string;

  constructor(summary: string, remedy: string) {
    super(frame(summary, remedy));
    this.name = 'StartupError';
    this.summary = summary;
    this.remedy = remedy;
  }
}

function frame(summary: string, remedy: string): string {
  return ['API failed to start.', '', `  ${summary}`, '', `  ${remedy}`, ''].join('\n');
}
