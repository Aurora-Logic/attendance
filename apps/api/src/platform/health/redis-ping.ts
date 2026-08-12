import { createConnection, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

/**
 * A RESP PING, spoken directly over the socket.
 *
 * Readiness is the one thing that must not depend on the client library being
 * healthy, and BullMQ's Redis client does not exist yet (technical design §11
 * lands in a later phase). Adding a Redis dependency to answer one question
 * with a seven-byte round trip is not a trade worth making, and a raw socket
 * check has a property the library check does not: it fails when the server is
 * unreachable, rather than when a connection pool decides to report it.
 */

const PONG = '+PONG';

function encodeCommand(args: readonly string[]): string {
  // RESP array of bulk strings. Inline commands would be shorter, but they
  // cannot carry a password containing a space.
  const parts = args.map((arg) => `$${String(Buffer.byteLength(arg))}\r\n${arg}\r\n`);
  return `*${String(args.length)}\r\n${parts.join('')}`;
}

function openSocket(url: URL, timeoutMs: number): Socket {
  const port = url.port === '' ? 6379 : Number.parseInt(url.port, 10);
  const host = url.hostname;
  const socket =
    url.protocol === 'rediss:'
      ? tlsConnect({ host, port, servername: host })
      : createConnection({ host, port });
  socket.setTimeout(timeoutMs);
  return socket;
}

/**
 * Resolves when the server answers `+PONG`. Rejects on connect failure,
 * timeout, or an error reply -- including the `-NOAUTH` a password-protected
 * server sends, which is a genuine readiness failure rather than a detail to
 * paper over.
 */
export function redisPing(connectionUrl: string, timeoutMs = 2_000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(connectionUrl);
    } catch (cause) {
      reject(new Error(`REDIS_URL is not a valid URL.`, { cause }));
      return;
    }

    const socket = openSocket(url, timeoutMs);
    let buffer = '';
    let settled = false;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    socket.on('connect', () => {
      const commands: string[] = [];
      if (url.password !== '') {
        // Redis 6 ACLs take a username; a legacy password-only server takes
        // one argument. The URL tells us which form was configured.
        commands.push(
          url.username === ''
            ? encodeCommand(['AUTH', url.password])
            : encodeCommand(['AUTH', decodeURIComponent(url.username), url.password]),
        );
      }
      commands.push(encodeCommand(['PING']));
      socket.write(commands.join(''));
    });

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      if (buffer.includes(PONG)) {
        finish();
        return;
      }
      if (buffer.startsWith('-')) {
        finish(new Error(`Redis refused the check: ${buffer.split('\r\n')[0] ?? buffer}`));
      }
    });

    socket.on('timeout', () => {
      finish(new Error(`Redis did not answer PING within ${String(timeoutMs)}ms.`));
    });

    socket.on('error', (error: Error) => {
      finish(error);
    });

    socket.on('close', () => {
      finish(new Error('Redis closed the connection before answering PING.'));
    });
  });
}
