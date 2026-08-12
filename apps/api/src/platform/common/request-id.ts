import type { IncomingMessage, ServerResponse } from 'node:http';

import { uuidv7 } from '@vyuha/shared';

/**
 * Technical design §17: "structured JSON logs with a request ID threaded
 * through". The same id appears on the response header, in every log line for
 * the request, in the error envelope (§6), and in `audit_logs.request_id`, so
 * a user reporting "it failed at 09:41" can be traced end to end from the one
 * string on their screen.
 */

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * An inbound id is echoed so a load balancer or the web client can correlate,
 * but it is attacker-controlled text that ends up in log lines. Anything
 * outside this alphabet is discarded rather than sanitised: a caller sending
 * newlines is not trying to correlate anything.
 */
const ACCEPTABLE_INBOUND_ID = /^[A-Za-z0-9._:-]{8,128}$/u;

function inboundId(req: IncomingMessage): string | null {
  const header = req.headers[REQUEST_ID_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) return null;
  return ACCEPTABLE_INBOUND_ID.test(value) ? value : null;
}

/**
 * Idempotent. pino-http calls this as its `genReqId` and the middleware calls
 * it again; whichever runs first decides, and the second call returns the same
 * value rather than minting a competing one.
 */
export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const existing = req.id;
  if (typeof existing === 'string' && existing.length > 0) {
    if (!res.headersSent) res.setHeader(REQUEST_ID_HEADER, existing);
    return existing;
  }

  const id = inboundId(req) ?? uuidv7();
  req.id = id;
  if (!res.headersSent) res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

/**
 * Reads the id already assigned to a request. Used by the exception filter,
 * which must produce an envelope even for a request that failed before any
 * middleware ran.
 */
export function requestIdOf(req: Pick<IncomingMessage, 'id'> | undefined): string {
  const id = req?.id;
  return typeof id === 'string' && id.length > 0 ? id : uuidv7();
}
