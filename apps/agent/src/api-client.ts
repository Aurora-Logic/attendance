import type {
  AgentClaimResponse,
  AgentErrorAck,
  AgentErrorInput,
  AgentHeartbeatAck,
  AgentHeartbeatInput,
  AgentResultsAck,
  AgentResultsInput,
} from '@vyuha/shared';

/**
 * The four `/sync/agent/*` calls, typed by the shared contract (09 §5).
 *
 * Plain fetch, no retry layer: retry policy belongs to the loop, which knows
 * whether a call is idempotent (results are, by the writer's construction)
 * and what giving up means for the job it is holding.
 */

export class AgentApiError extends Error {
  constructor(
    readonly status: number,
    readonly serverMessage: string,
    call: string,
  ) {
    super(`${call} answered ${String(status)}: ${serverMessage}`);
    this.name = 'AgentApiError';
  }
}

export class AgentApiClient {
  constructor(
    private readonly serverUrl: string,
    private readonly token: string,
  ) {}

  heartbeat(input: AgentHeartbeatInput): Promise<AgentHeartbeatAck> {
    return this.post<AgentHeartbeatAck>('/sync/agent/heartbeat', input);
  }

  claim(input: { agentInstanceId: string; openCompanyGuid?: string }): Promise<AgentClaimResponse> {
    return this.post<AgentClaimResponse>('/sync/agent/jobs/claim', input);
  }

  results(input: AgentResultsInput): Promise<AgentResultsAck> {
    return this.post<AgentResultsAck>('/sync/agent/results', input);
  }

  reportError(input: AgentErrorInput): Promise<AgentErrorAck> {
    return this.post<AgentErrorAck>('/sync/agent/errors', input);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.serverUrl}/api/v1${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    if (!response.ok) {
      let message = text;
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } };
        message = parsed.error?.message ?? text;
      } catch {
        // The body was not the API's envelope; the raw text is the message.
      }
      throw new AgentApiError(response.status, message, path);
    }
    return JSON.parse(text) as T;
  }
}
