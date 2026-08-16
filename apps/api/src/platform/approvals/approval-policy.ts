import {
  isOpenApprovalStatus,
  type ApprovalStatus,
  type ErrorCode,
} from '@vyuha/shared';

/**
 * The rules of the approval framework, as pure functions.
 *
 * Nothing here touches the database, Nest, or a request. That is the point:
 * REQ-I-05 -- "an approver cannot approve their own request" -- is the one
 * rule in this slice that must hold under every combination of permission,
 * delegation and escalation, and a rule that can only be exercised by standing
 * up Postgres is a rule nobody exercises exhaustively.
 *
 * The service maps these results onto `AppError`; the codes below are the same
 * `ERROR_CODES` values so the mapping is a lookup rather than a translation.
 */

export interface DecisionRefusal {
  readonly code: Extract<
    ErrorCode,
    'APPROVAL_ALREADY_ACTIONED' | 'APPROVER_IS_REQUESTER' | 'FORBIDDEN'
  >;
  readonly message: string;
}

export interface DecisionContext {
  readonly actorUserId: string;
  readonly requesterUserId: string;
  readonly status: ApprovalStatus;
  /** Who the current step is routed to. Null when the route ran out. */
  readonly currentApproverUserId: string | null;
  /** Approvers who have a live delegation to the actor today (REQ-I-04). */
  readonly delegatedFromUserIds: readonly string[];
  /**
   * `leave.approve.all`. REQ-G-09 escalates to HR, so an HR holder has to be
   * able to act on a step that was never routed to them personally.
   */
  readonly hasApproveAll: boolean;
}

export type DecisionEligibility =
  | {
      readonly ok: true;
      /** Set only when the actor is acting under someone else's authority. */
      readonly delegatedFromUserId: string | null;
    }
  | { readonly ok: false; readonly refusal: DecisionRefusal };

/**
 * May this actor decide this request, and on whose authority?
 *
 * **The order of these checks is the requirement.** The self-approval refusal
 * comes before the `leave.approve.all` bypass, and swapping the two would let
 * an HR user approve their own leave -- which is the exact hole REQ-I-05
 * exists to close, and the one that would never show up in a happy-path test
 * because HR is also the account most tests use to set fixtures up.
 */
export function evaluateDecision(context: DecisionContext): DecisionEligibility {
  if (!isOpenApprovalStatus(context.status)) {
    return {
      ok: false,
      refusal: {
        code: 'APPROVAL_ALREADY_ACTIONED',
        message: 'This request has already been decided.',
      },
    };
  }

  // REQ-I-05. Before every grant below, including the org-wide one.
  if (context.actorUserId === context.requesterUserId) {
    return {
      ok: false,
      refusal: {
        code: 'APPROVER_IS_REQUESTER',
        message: 'You cannot decide a request you raised. It routes to the next level up.',
      },
    };
  }

  if (context.currentApproverUserId === context.actorUserId) {
    return { ok: true, delegatedFromUserId: null };
  }

  if (
    context.currentApproverUserId !== null &&
    context.delegatedFromUserIds.includes(context.currentApproverUserId)
  ) {
    return { ok: true, delegatedFromUserId: context.currentApproverUserId };
  }

  if (context.hasApproveAll) return { ok: true, delegatedFromUserId: null };

  return {
    ok: false,
    refusal: {
      code: 'FORBIDDEN',
      message: 'This request is not waiting on you.',
    },
  };
}

/**
 * The route a new request will follow, from the approvers its raiser proposed.
 *
 * REQ-I-05's second half -- "it routes to the next level up" -- is applied
 * here rather than at decision time, because a request that sits in its own
 * author's inbox until they notice they cannot act on it is a request that
 * waits for the escalation job to rescue it. Dropping the requester from the
 * route makes the next level the first level.
 *
 * Duplicates are collapsed for the same reason: an approver who appears at two
 * levels would be asked the same question twice, and the second answer is
 * never different.
 */
export function planRoute(
  requesterUserId: string,
  candidates: readonly string[],
): string[] {
  const route: string[] = [];
  for (const candidate of candidates) {
    if (candidate === requesterUserId) continue;
    if (route.includes(candidate)) continue;
    route.push(candidate);
  }
  return route;
}

/**
 * Where an escalation sends a request that its current approver has left
 * untouched (REQ-G-09).
 *
 * Returns null when the chain is exhausted, which the job treats as "leave it
 * pending and say so" rather than as an error: escalating a request to nobody
 * would close it, and a request closed by a timer is a decision nobody made.
 */
export function nextEscalationTarget(input: {
  readonly chain: readonly string[];
  readonly currentApproverUserId: string | null;
  readonly requesterUserId: string;
  readonly alreadyRoutedUserIds: readonly string[];
}): string | null {
  const currentIndex =
    input.currentApproverUserId === null
      ? -1
      : input.chain.indexOf(input.currentApproverUserId);

  // Everything after the current approver in the chain. When the current
  // approver is not in the chain at all -- the reporting line changed since
  // the request was raised -- the whole chain is still a candidate, minus who
  // has already had it.
  const remainder = input.chain.slice(currentIndex + 1);

  for (const candidate of remainder) {
    if (candidate === input.requesterUserId) continue;
    if (candidate === input.currentApproverUserId) continue;
    if (input.alreadyRoutedUserIds.includes(candidate)) continue;
    return candidate;
  }

  return null;
}

/** Whole days elapsed, floored. Used only to compare against a threshold. */
export function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * REQ-G-09: "Auto-escalate to HR if untouched for N days (default 3)."
 *
 * Measured from when the current step started, not from when the request was
 * raised. A request that reached step two yesterday has not been untouched for
 * three days even if it was raised a week ago -- escalating it would punish
 * the second approver for the first one's delay.
 */
export function isStale(input: {
  readonly now: Date;
  readonly currentStepStartedAt: Date;
  readonly escalateAfterDays: number;
}): boolean {
  if (input.escalateAfterDays <= 0) return false;
  return daysBetween(input.currentStepStartedAt, input.now) >= input.escalateAfterDays;
}
