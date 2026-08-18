import type { AgentResultsInput, SyncEntityType } from '@vyuha/shared';
import { SYNC_ENTITY_TYPES } from '@vyuha/shared';

import { type AgentApiClient, AgentApiError } from './api-client.js';
import type { TallyTransport } from './transport.js';

/**
 * The agent's whole behaviour, one tick at a time (09 §3.4).
 *
 * `tick()` is one heartbeat followed by draining the queue, and it never
 * throws: every failure is either reported to the server (`/sync/agent/errors`)
 * or logged and retried on the next tick, because an agent that crashes on a
 * flaky office connection is an agent somebody has to notice and restart —
 * the exact ceremony REQ-Q-07 forbids. The main loop just calls this on a
 * timer; tests call it directly.
 *
 * Losing a race is normal here, not exceptional: a 409 from the claim or the
 * results means the lease moved or the job was swept, and the answer is to
 * heartbeat again next tick, not to die. Only the transport's failures are
 * *reported* — they are facts about Tally a person may need to act on
 * (REQ-T-01); everything else is the protocol working as designed.
 */

export interface AgentLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface TickReport {
  readonly heartbeatOk: boolean;
  readonly jobsCompleted: number;
  readonly jobsFailed: number;
}

export class VyuhaAgent {
  constructor(
    private readonly api: AgentApiClient,
    private readonly transport: TallyTransport,
    private readonly instanceId: string,
    private readonly log: AgentLogger,
  ) {}

  async tick(): Promise<TickReport> {
    let openCompanyGuid: string | undefined;
    try {
      const probe = await this.transport.probe();
      const ack = await this.api.heartbeat({
        agentInstanceId: this.instanceId,
        agentVersion: AGENT_VERSION,
        condition: probe.condition,
        ...(probe.openCompanyGuid === undefined ? {} : { openCompanyGuid: probe.openCompanyGuid }),
        ...(probe.tallyVersion === undefined ? {} : { tallyVersion: probe.tallyVersion }),
      });
      openCompanyGuid = probe.openCompanyGuid;
      if (ack.condition !== 'OK') {
        // The server may know better than the probe (WRONG_COMPANY_OPEN is
        // its call). No work is claimable in any non-OK condition.
        this.log.warn(`Condition ${ack.condition}; not claiming work this tick.`);
        return { heartbeatOk: true, jobsCompleted: 0, jobsFailed: 0 };
      }
    } catch (error: unknown) {
      // A lost heartbeat is the one failure with nobody to tell: the server
      // could not be reached, or refused the lease. Next tick retries.
      this.log.warn(`Heartbeat failed: ${describe(error)}`);
      return { heartbeatOk: false, jobsCompleted: 0, jobsFailed: 0 };
    }

    let completed = 0;
    let failed = 0;
    // Drain: claim until the queue answers empty. The server hands jobs out
    // in creation order, which is dependency order (items before prices).
    for (;;) {
      let job;
      try {
        const response = await this.api.claim({
          agentInstanceId: this.instanceId,
          ...(openCompanyGuid === undefined ? {} : { openCompanyGuid }),
        });
        job = response.job;
      } catch (error: unknown) {
        this.log.warn(`Claim refused: ${describe(error)}`);
        break;
      }
      if (job === null) break;

      if (job.direction !== 'PULL' || !isPullable(job.entityType)) {
        // A job this build cannot run: report rather than silently strand it
        // CLAIMED until the sweep fails it with no explanation anywhere.
        await this.reportQuietly({
          agentInstanceId: this.instanceId,
          jobId: job.id,
          errorCode: 'UNSUPPORTED_JOB',
          errorText: `This agent build cannot run ${job.direction} ${job.entityType}.`,
        });
        failed += 1;
        continue;
      }

      try {
        await this.runPull(job.id, job.entityType, job.fromAlterId, openCompanyGuid ?? '');
        completed += 1;
      } catch (error: unknown) {
        failed += 1;
        if (error instanceof AgentApiError) {
          // The server refused the results (lease moved, job swept). It
          // already knows everything this report would say.
          this.log.warn(`Results refused for job ${job.id}: ${error.serverMessage}`);
        } else {
          // Tally-side failure: the fact a person may need to act on.
          await this.reportQuietly({
            agentInstanceId: this.instanceId,
            jobId: job.id,
            entityType: job.entityType,
            errorCode: 'TRANSPORT_ERROR',
            errorText: describe(error),
          });
        }
      }
    }

    return { heartbeatOk: true, jobsCompleted: completed, jobsFailed: failed };
  }

  private async runPull(
    jobId: string,
    entityType: SyncEntityType,
    fromAlterId: number,
    openCompanyGuid: string,
  ): Promise<void> {
    const chunks = await this.transport.pull(entityType, fromAlterId);
    for (const [index, chunk] of chunks.entries()) {
      const input = {
        agentInstanceId: this.instanceId,
        openCompanyGuid,
        jobId,
        entityType,
        rows: chunk.rows,
        requestHash: chunk.requestHash,
        responseHash: chunk.responseHash,
        ...(chunk.requestBody === undefined ? {} : { requestBody: chunk.requestBody }),
        ...(chunk.responseBody === undefined ? {} : { responseBody: chunk.responseBody }),
        final: index === chunks.length - 1,
      } as AgentResultsInput;
      const ack = await this.api.results(input);
      this.log.info(
        `Job ${jobId}: chunk ${String(index + 1)}/${String(chunks.length)} written=${String(ack.written)} cursor=${String(ack.lastAlterId)}`,
      );
    }
  }

  /** An error report must never mask the error it is about. */
  private async reportQuietly(input: Parameters<AgentApiClient['reportError']>[0]): Promise<void> {
    try {
      await this.api.reportError(input);
    } catch (error: unknown) {
      this.log.error(`Could not report an error to the server: ${describe(error)}`);
    }
  }
}

export const AGENT_VERSION = '0.1.0';

function isPullable(entityType: string): entityType is SyncEntityType {
  return (SYNC_ENTITY_TYPES as readonly string[]).includes(entityType);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
