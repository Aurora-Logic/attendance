import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { agentClaimSchema, agentHeartbeatSchema } from '@vyuha/shared';
import type { AgentClaimResponse, AgentHeartbeatAck } from '@vyuha/shared';

import { createZodDto } from '../common/zod-validation.pipe.js';
import { AgentRoute } from '../rbac/route-policy.js';
import { CurrentAgent, type AgentPrincipal } from './agent-principal.js';
import { SyncAgentService } from './sync-agent.service.js';

class AgentHeartbeatDto extends createZodDto(agentHeartbeatSchema) {}
class AgentClaimDto extends createZodDto(agentClaimSchema) {}

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
  constructor(private readonly sync: SyncAgentService) {}

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
