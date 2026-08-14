import { createHash } from 'node:crypto';

import type { Redis } from 'ioredis';

/**
 * A Lua script Redis evaluates server-side, so a read and the write that
 * depends on it cannot be interleaved by anything else.
 *
 * MULTI is not a substitute. A pipeline of ZCARD-then-decide-then-ZADD is two
 * round trips with a decision made in Node between them, and every request in
 * flight during that gap reads the same count -- which is how both sliding
 * window limiters in `platform/auth` were defeated by adding `&` to the
 * attacker's loop. Redis runs a script to completion before serving another
 * command, so "check, then record" becomes one indivisible step, and it stays
 * indivisible across API instances because the decision happens in the one
 * place they share.
 *
 * EVALSHA first and EVAL only on NOSCRIPT: the script body then crosses the
 * socket once per process rather than once per request, and a Redis that was
 * restarted or had its script cache flushed recovers on the next call instead
 * of failing it. The SHA1 is computed here rather than remembered from a
 * SCRIPT LOAD, so a client that reconnected to a different server still
 * addresses the right script.
 */
export class LuaScript {
  private readonly sha: string;

  constructor(private readonly source: string) {
    // Redis addresses cached scripts by the SHA1 of their exact source text.
    this.sha = createHash('sha1').update(source).digest('hex');
  }

  async run(
    redis: Redis,
    keys: readonly string[],
    args: readonly string[],
  ): Promise<unknown> {
    try {
      return await redis.evalsha(this.sha, keys.length, ...keys, ...args);
    } catch (error: unknown) {
      if (!isNoScript(error)) throw error;
      return await redis.eval(this.source, keys.length, ...keys, ...args);
    }
  }
}

/** Redis reports an uncached SHA as an error whose message begins NOSCRIPT. */
function isNoScript(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('NOSCRIPT');
}
