import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { agentClaimSchema, agentHeartbeatSchema, agentResultsSchema } from '@vyuha/shared';
import type { AgentClaimResponse, AgentHeartbeatAck, AgentResultsAck } from '@vyuha/shared';

import { AuditContext } from '../audit/audit-context.js';
import { createZodDto } from '../common/zod-validation.pipe.js';
import { AgentRoute } from '../rbac/route-policy.js';
import { CurrentAgent, type AgentPrincipal } from './agent-principal.js';
import { SyncAgentService } from './sync-agent.service.js';
import { SyncWriterService } from './sync-writer.service.js';

class AgentHeartbeatDto extends createZodDto(agentHeartbeatSchema) {}
class AgentClaimDto extends createZodDto(agentClaimSchema) {}
class AgentResultsDto extends createZodDto(agentResultsSchema) {}

/**
 * `/api/v1/sync/agent/*` (09 §5) — the only routes an agent credential can
 * reach, and routes nothing else can. The direction of every arrow is the
 * design (09 §1): the agent calls out, Vyuha never calls in.
 *
 * Claiming is a POST although 09's sketch spells it GET: a claim mutates the
 * job row, and a mutating GET is the kind of thing a retrying HTTP client is
 * entitled to repeat without asking.
 */
@Controller('sync/agent')
export class SyncAgentController {
  constructor(
    private readonly sync: SyncAgentService,
    private readonly writer: SyncWriterService,
    private readonly auditContext: AuditContext,
  ) {}

  /** REQ-Q-04: every 60 seconds, and the lease rides on it. */
  @Post('heartbeat')
  @AgentRoute()
  @HttpCode(HttpStatus.OK)
  heartbeat(
    @CurrentAgent() agent: AgentPrincipal,
    @Body() body: AgentHeartbeatDto,
  ): Promise<AgentHeartbeatAck> {
    return this.sync.heartbeat(agent, body);
  }

  /**
   * One chunk of pull results (09 §3.2). The journal row the writer commits
   * is this exchange's audit trail — richer than an audit_logs row could be,
   * because it carries the payload hashes — so the automatic row is
   * suppressed the same way the heartbeat's is.
   */
  @Post('results')
  @AgentRoute()
  @HttpCode(HttpStatus.OK)
  async results(
    @CurrentAgent() agent: AgentPrincipal,
    @Body() body: AgentResultsDto,
  ): Promise<AgentResultsAck> {
    const ack = await this.writer.ingestParties(agent, body);
    this.auditContext.suppress();
    return ack;
  }

  /** REQ-Q-02: the agent polls for work; an empty queue answers null, not 404. */
  @Post('jobs/claim')
  @AgentRoute()
  @HttpCode(HttpStatus.OK)
  claim(
    @CurrentAgent() agent: AgentPrincipal,
    @Body() body: AgentClaimDto,
  ): Promise<AgentClaimResponse> {
    return this.sync.claim(agent, body);
  }
}
