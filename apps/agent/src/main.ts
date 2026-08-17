import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AgentApiClient } from './api-client.js';
import { AGENT_VERSION, VyuhaAgent } from './agent.js';
import { loadConfig } from './config.js';
import { FixtureTransport } from './transport.js';

const currentDir = dirname(fileURLToPath(import.meta.url));

/**
 * Entry point (REQ-Q-01, REQ-Q-07).
 *
 * `vyuha-agent [path/to/vyuha-agent.json]` — config beside the binary by
 * default. Runs forever on a timer; SIGINT/SIGTERM stop it after the current
 * tick, so killing it mid-chunk loses nothing (the writer's idempotency is
 * what makes that true, not anything here).
 *
 * Until real Tally fixtures arrive (10 §8, D-05), the only transport is the
 * fixture file: pass `fixture` in config as a path. The binary refuses to
 * start without one rather than pretending a Tally transport exists.
 */

function log(level: 'info' | 'warn' | 'error', message: string): void {
  // Plain lines: this runs as a Windows service with output redirected to a
  // file, and a person reads it with Notepad, not a log pipeline.
  console[level](`${new Date().toISOString()} ${level.toUpperCase()} ${message}`);
}

async function main(): Promise<void> {
  const configPath = process.argv[2] ?? join(process.cwd(), 'vyuha-agent.json');
  if (!existsSync(configPath)) {
    log(
      'warn',
      `No configuration at ${configPath}. Agent is idling. Create it with: {"serverUrl": "https://…", "agentToken": "vyagt_…"}`,
    );
    await new Promise<void>((resolve) => {
      process.on('SIGINT', () => { resolve(); });
      process.on('SIGTERM', () => { resolve(); });
    });
    return;
  }
  const config = loadConfig(configPath);

  // The transport seam: TallyHttpTransport lands with the XML fixtures.
  const fixturePath =
    process.env['VYUHA_AGENT_FIXTURE'] ?? join(currentDir, '../fixtures/demo.json');
  const transport = new FixtureTransport(fixturePath);

  const api = new AgentApiClient(config.serverUrl, config.agentToken);
  const agent = new VyuhaAgent(api, transport, config.instanceId, {
    info: (m) => { log('info', m); },
    warn: (m) => { log('warn', m); },
    error: (m) => { log('error', m); },
  });

  log('info', `Vyuha agent ${AGENT_VERSION} as ${config.instanceId} → ${config.serverUrl}`);

  let running = true;
  const stop = (): void => {
    log('info', 'Stopping after the current tick.');
    running = false;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (running) {
    const report = await agent.tick();
    if (report.jobsCompleted > 0 || report.jobsFailed > 0) {
      log(
        'info',
        `Tick: completed=${String(report.jobsCompleted)} failed=${String(report.jobsFailed)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, config.heartbeatSeconds * 1000));
  }
}

main().catch((error: unknown) => {
  log('error', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
