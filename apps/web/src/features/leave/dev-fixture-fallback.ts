import { ApiError } from '@/lib/api/client';

/**
 * The temporary bridge between four finished screens and four endpoints that
 * do not exist yet.
 *
 * Every screen calls its real endpoint through `apiRequest` and parses the
 * real contract. Only when that request comes back "there is no such thing" —
 * and only in development — does the query serve fixtures instead, and the
 * screen then says so on the page (`sample-data-notice.tsx`). Nothing is ever
 * fabricated silently.
 *
 * Removing this later is meant to be a deletion, not a rewrite: the query
 * keeps returning the server's own `{ data, meta }` envelope, so a screen
 * reads `query.data.data` either way. What disappears is the extra `sample`
 * field and the one line that renders the notice.
 *
 * It lives in the leave feature, alongside the single fixtures module that
 * covers all of Phase 2, because approvals and holidays share both. Splitting
 * it three ways would give three copies to delete instead of one.
 */

export type Sampled<T> = T & { sample: boolean };

/**
 * "The server does not serve this yet", as distinct from "the server said no".
 *
 * A 403 or a validation failure must still reach the screen's error state: an
 * unbuilt endpoint is the only thing sample data is allowed to stand in for,
 * and swallowing a permission error behind plausible rows would be a lie about
 * what the reader is allowed to see.
 */
function isUnbuiltEndpoint(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.code === 'NETWORK_ERROR' || error.code === 'NOT_FOUND' || error.status === 404;
}

/**
 * `pick` takes the whole fixtures module rather than a prepared value so the
 * only `import()` of that module sits inside the `import.meta.env.DEV` branch
 * below. Vite replaces `import.meta.env.DEV` with `false` in a production
 * build, the branch folds away, and the fixtures leave the module graph
 * entirely — verified by building and searching the output, not assumed.
 */
export async function withDevFixture<T extends object>(
  load: () => Promise<T>,
  pick: (fixtures: typeof import('@/lib/fixtures/leave')) => T,
): Promise<Sampled<T>> {
  try {
    return { ...(await load()), sample: false };
  } catch (error) {
    if (import.meta.env.DEV && isUnbuiltEndpoint(error)) {
      const fixtures = await import('@/lib/fixtures/leave');
      return { ...pick(fixtures), sample: true };
    }
    throw error;
  }
}
