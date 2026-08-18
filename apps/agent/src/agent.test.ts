import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AgentApiClient } from './api-client.js';
import { VyuhaAgent } from './agent.js';
import { FixtureTransport } from './transport.js';

/**
 * The loop against a scripted server (REQ-Q-02, 09 §3.4): what the agent
 * sends, in what order, and what it does when the server or Tally refuses.
 * The server here is a plain http server so the whole HTTP client path runs
 * — the real protocol conformance test is the API's own agent suite; this
 * one holds the *agent's* half of the contract still.
 */

interface RecordedCall {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

let server: Server;
let baseUrl = '';
const calls: RecordedCall[] = [];
/** Scripted per test: path → queue of responses (status, body). */
let script: Record<string, { status: number; body: unknown }[]>;

const noopLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

function scripted(path: string): { status: number; body: unknown } {
  const queue = script[path];
  const next = queue?.shift();
  if (next === undefined) throw new Error(`Unscripted call to ${path}`);
  return next;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (piece: string) => (raw += piece));
    req.on('end', () => {
      const path = (req.url ?? '').replace('/api/v1', '');
      const body = raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>);
      calls.push({ path, body });
      const answer = scripted(path);
      res.statusCode = answer.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No listen address');
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  calls.length = 0;
  script = {};
});

const fixtureDir = mkdtempSync(join(tmpdir(), 'vyuha-agent-test-'));
const fixturePath = join(fixtureDir, 'fixture.json');
writeFileSync(
  fixturePath,
  JSON.stringify({
    companyGuid: 'fixture-guid',
    parties: [
      { guid: 'p-1', alterId: 10, name: 'Asha Traders', parentGroup: 'Sundry Debtors' },
      { guid: 'p-2', alterId: 20, name: 'Behar Supply Co', parentGroup: 'Sundry Creditors' },
    ],
    stockItems: [],
    priceLists: [],
  }),
);

function makeAgent(): VyuhaAgent {
  const api = new AgentApiClient(baseUrl, 'vyagt_test-token');
  return new VyuhaAgent(api, new FixtureTransport(fixturePath), 'test-instance', noopLog);
}

const heartbeatOk = {
  status: 200,
  body: { connectionId: 'c1', companyGuid: 'fixture-guid', condition: 'OK', leaseTakeoverMinutes: 5 },
};
const claimEmpty = { status: 200, body: { job: null } };

describe('one tick', () => {
  it('heartbeats, claims, posts every row above the cursor as a final chunk, drains', async () => {
    script = {
      '/sync/agent/heartbeat': [heartbeatOk],
      '/sync/agent/jobs/claim': [
        {
          status: 200,
          body: {
            job: { id: 'job-1', direction: 'PULL', entityType: 'party', payload: null, attempts: 1, fromAlterId: 0 },
          },
        },
        claimEmpty,
      ],
      '/sync/agent/results': [
        { status: 200, body: { jobId: 'job-1', written: 2, lastAlterId: 20, jobState: 'DONE' } },
      ],
    };

    const report = await makeAgent().tick();
    expect(report).toEqual({ heartbeatOk: true, jobsCompleted: 1, jobsFailed: 0 });

    const results = calls.filter((c) => c.path === '/sync/agent/results');
    expect(results.length).toBe(1);
    expect(results[0]?.body['final']).toBe(true);
    expect((results[0]?.body['rows'] as unknown[]).length).toBe(2);
    // The heartbeat told the server which books are open; results repeat it.
    expect(results[0]?.body['openCompanyGuid']).toBe('fixture-guid');
    expect(String(results[0]?.body['requestHash'])).toMatch(/^sha256:/u);
  });

  it('honours the server cursor: only rows above fromAlterId travel', async () => {
    script = {
      '/sync/agent/heartbeat': [heartbeatOk],
      '/sync/agent/jobs/claim': [
        {
          status: 200,
          body: {
            job: { id: 'job-2', direction: 'PULL', entityType: 'party', payload: null, attempts: 1, fromAlterId: 10 },
          },
        },
        claimEmpty,
      ],
      '/sync/agent/results': [
        { status: 200, body: { jobId: 'job-2', written: 1, lastAlterId: 20, jobState: 'DONE' } },
      ],
    };

    await makeAgent().tick();
    const results = calls.filter((c) => c.path === '/sync/agent/results');
    const rows = results[0]?.body['rows'] as { guid: string }[];
    expect(rows.map((r) => r.guid)).toEqual(['p-2']);
  });

  it('a refused heartbeat means no claim this tick — the lease is the law', async () => {
    script = {
      '/sync/agent/heartbeat': [
        { status: 409, body: { error: { message: 'Another agent instance holds this lease.' } } },
      ],
    };

    const report = await makeAgent().tick();
    expect(report.heartbeatOk).toBe(false);
    expect(calls.some((c) => c.path === '/sync/agent/jobs/claim')).toBe(false);
  });

  it('refused results are not re-reported: the server already knows', async () => {
    script = {
      '/sync/agent/heartbeat': [heartbeatOk],
      '/sync/agent/jobs/claim': [
        {
          status: 200,
          body: {
            job: { id: 'job-3', direction: 'PULL', entityType: 'party', payload: null, attempts: 1, fromAlterId: 0 },
          },
        },
        claimEmpty,
      ],
      '/sync/agent/results': [
        { status: 409, body: { error: { message: 'claimed over' } } },
      ],
    };

    const report = await makeAgent().tick();
    expect(report.jobsFailed).toBe(1);
    expect(calls.some((c) => c.path === '/sync/agent/errors')).toBe(false);
  });

  it('pushes one voucher per job and posts the outcome; a retry that already landed reports so and pushes nothing', async () => {
    const payload = {
      documentId: '01900000-0000-7000-8000-00000000aa01',
      docType: 'SALES_ORDER',
      voucherType: 'Sales Order',
      reference: 'SO-0001',
      date: '2026-08-18',
      partyName: 'Asha Traders',
      narration: 'vyuha:SO-0001',
      idempotencyKey: 'vyuha:so-1',
      remoteGuid: null,
      lines: [{ stockItemName: 'Cat6 cable 305m', quantity: '2.000', unit: 'BOX', rate: '4000.00', discountPct: '0.00', amount: '8000.00' }],
    };
    const ack = { status: 200, body: { jobId: 'job-p1', written: 0, lastAlterId: 0, jobState: 'DONE' } };
    script = {
      '/sync/agent/heartbeat': [heartbeatOk, heartbeatOk],
      '/sync/agent/jobs/claim': [
        { status: 200, body: { job: { id: 'job-p1', direction: 'PUSH', entityType: 'voucher_push:01900000-0000-7000-8000-00000000aa01', payload, attempts: 1, fromAlterId: 0 } } },
        claimEmpty,
        // Second tick: the same job again on attempt 2 — the previous response was "lost".
        { status: 200, body: { job: { id: 'job-p1', direction: 'PUSH', entityType: 'voucher_push:01900000-0000-7000-8000-00000000aa01', payload, attempts: 2, fromAlterId: 0 } } },
        claimEmpty,
      ],
      '/sync/agent/results': [ack, ack],
    };

    const agent = makeAgent();
    const first = await agent.tick();
    expect(first.jobsCompleted).toBe(1);
    const posted = calls.filter((c) => c.path === '/sync/agent/results');
    expect(posted).toHaveLength(1);
    expect(posted[0]?.body['entityType']).toBe('voucher_push');
    expect(posted[0]?.body['outcome']).toBe('accepted');
    expect(String(posted[0]?.body['remoteGuid'])).toMatch(/^fixture-guid-/u);

    const second = await agent.tick();
    expect(second.jobsCompleted).toBe(1);
    const again = calls.filter((c) => c.path === '/sync/agent/results');
    expect(again).toHaveLength(2);
    // The idempotency rule: found in Tally, so no second voucher.
    expect(again[1]?.body['outcome']).toBe('landed_on_retry');
    expect(again[1]?.body['remoteGuid']).toBe(posted[0]?.body['remoteGuid']);
  });

  it('a rejected push carries Tally’s words verbatim', async () => {
    const payload = {
      documentId: '01900000-0000-7000-8000-00000000aa02',
      docType: 'SALES_ORDER',
      voucherType: 'Sales Order',
      reference: 'SO-0002',
      date: '2026-08-18',
      partyName: 'Nobody Known',
      narration: '',
      idempotencyKey: 'vyuha:so-2',
      remoteGuid: null,
      lines: [{ stockItemName: 'X', quantity: '1', unit: null, rate: '1', discountPct: '0', amount: '1' }],
    };
    script = {
      '/sync/agent/heartbeat': [heartbeatOk],
      '/sync/agent/jobs/claim': [
        { status: 200, body: { job: { id: 'job-p2', direction: 'PUSH', entityType: 'voucher_push:01900000-0000-7000-8000-00000000aa02', payload, attempts: 1, fromAlterId: 0 } } },
        claimEmpty,
      ],
      '/sync/agent/results': [{ status: 200, body: { jobId: 'job-p2', written: 0, lastAlterId: 0, jobState: 'DONE' } }],
    };
    await makeAgent().tick();
    const posted = calls.find((c) => c.path === '/sync/agent/results');
    expect(posted?.body['outcome']).toBe('rejected');
    expect(posted?.body['errorText']).toBe("Ledger 'Nobody Known' does not exist!");
  });

  it('an unrunnable job is reported, not stranded CLAIMED', async () => {
    script = {
      '/sync/agent/heartbeat': [heartbeatOk],
      '/sync/agent/jobs/claim': [
        {
          status: 200,
          body: {
            job: { id: 'job-4', direction: 'PUSH', entityType: 'voucher', payload: null, attempts: 1, fromAlterId: 0 },
          },
        },
        claimEmpty,
      ],
      '/sync/agent/errors': [{ status: 200, body: { exceptionId: 'e1', jobFailed: true } }],
    };

    const report = await makeAgent().tick();
    expect(report.jobsFailed).toBe(1);
    const reportCall = calls.find((c) => c.path === '/sync/agent/errors');
    expect(reportCall?.body['jobId']).toBe('job-4');
    expect(String(reportCall?.body['errorText'])).toContain('cannot run PUSH voucher');
  });
});
