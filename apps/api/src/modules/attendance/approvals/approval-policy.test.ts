import { describe, expect, it } from 'vitest';

import {
  daysBetween,
  evaluateDecision,
  isStale,
  nextEscalationTarget,
  planRoute,
  type DecisionContext,
} from './approval-policy.js';

/**
 * The rules of the approval framework, exercised without a database.
 *
 * REQ-I-05 is the reason this file exists as a unit test rather than only as
 * an endpoint test. "An approver cannot approve their own request" has to hold
 * across every combination of permission, delegation and step, and an
 * integration test can only afford to walk a handful of them.
 */

const ALICE = 'user-alice';
const BOB = 'user-bob';
const CARLA = 'user-carla';
const DEV = 'user-dev';

function context(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    actorUserId: BOB,
    requesterUserId: ALICE,
    status: 'PENDING',
    currentApproverUserId: BOB,
    delegatedFromUserIds: [],
    hasApproveAll: false,
    ...overrides,
  };
}

describe('evaluateDecision', () => {
  it('lets the approver the step is routed to decide it', () => {
    const result = evaluateDecision(context());
    expect(result).toEqual({ ok: true, delegatedFromUserId: null });
  });

  // REQ-I-05. If this test passes with the self-check deleted, the check was
  // never doing anything.
  it('refuses the requester, even when they are the routed approver', () => {
    const result = evaluateDecision(
      context({ actorUserId: ALICE, currentApproverUserId: ALICE }),
    );
    expect(result).toEqual({
      ok: false,
      refusal: {
        code: 'APPROVER_IS_REQUESTER',
        message: expect.stringContaining('cannot decide a request you raised'),
      },
    });
  });

  /**
   * The ordering test. `leave.approve.all` is the widest grant in the product
   * and HR holds it, so an HR user applying for leave is the single most
   * likely way REQ-I-05 gets broken -- and the least likely to be noticed,
   * because HR is also the account most fixtures are built with.
   */
  it('refuses the requester even when they hold leave.approve.all', () => {
    const result = evaluateDecision(
      context({ actorUserId: ALICE, currentApproverUserId: BOB, hasApproveAll: true }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.refusal.code).toBe('APPROVER_IS_REQUESTER');
  });

  it('refuses the requester even when someone delegated to them', () => {
    const result = evaluateDecision(
      context({
        actorUserId: ALICE,
        currentApproverUserId: BOB,
        delegatedFromUserIds: [BOB],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.refusal.code).toBe('APPROVER_IS_REQUESTER');
  });

  it.each(['APPROVED', 'REJECTED', 'CANCELLED'] as const)(
    'refuses a request already in %s',
    (status) => {
      const result = evaluateDecision(context({ status }));
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.refusal.code).toBe('APPROVAL_ALREADY_ACTIONED');
    },
  );

  // REQ-G-09 escalates rather than closing, so ESCALATED has to stay decidable.
  it('treats an escalated request as still open', () => {
    expect(evaluateDecision(context({ status: 'ESCALATED' })).ok).toBe(true);
  });

  it('lets a delegate act, and names whose authority they used', () => {
    const result = evaluateDecision(
      context({
        actorUserId: CARLA,
        currentApproverUserId: BOB,
        delegatedFromUserIds: [BOB],
      }),
    );
    expect(result).toEqual({ ok: true, delegatedFromUserId: BOB });
  });

  it('does not let a delegation from someone else stand in for this step', () => {
    const result = evaluateDecision(
      context({
        actorUserId: CARLA,
        currentApproverUserId: BOB,
        delegatedFromUserIds: [DEV],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.refusal.code).toBe('FORBIDDEN');
  });

  it('lets an org-wide approver act on a step routed elsewhere', () => {
    const result = evaluateDecision(
      context({ actorUserId: CARLA, currentApproverUserId: BOB, hasApproveAll: true }),
    );
    expect(result).toEqual({ ok: true, delegatedFromUserId: null });
  });

  it('refuses a stranger with no key, no step and no delegation', () => {
    const result = evaluateDecision(context({ actorUserId: CARLA }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.refusal.code).toBe('FORBIDDEN');
  });

  it('refuses everyone but an org-wide approver when the route ran out', () => {
    expect(evaluateDecision(context({ currentApproverUserId: null })).ok).toBe(false);
    expect(
      evaluateDecision(context({ currentApproverUserId: null, hasApproveAll: true })).ok,
    ).toBe(true);
  });
});

describe('planRoute', () => {
  it('drops the requester so the route starts at the next level up', () => {
    expect(planRoute(ALICE, [ALICE, BOB, CARLA])).toEqual([BOB, CARLA]);
  });

  it('collapses an approver who appears at two levels', () => {
    expect(planRoute(ALICE, [BOB, CARLA, BOB])).toEqual([BOB, CARLA]);
  });

  it('returns nothing when the requester is the only candidate', () => {
    expect(planRoute(ALICE, [ALICE, ALICE])).toEqual([]);
  });

  it('preserves the order it was given', () => {
    expect(planRoute(DEV, [CARLA, BOB, ALICE])).toEqual([CARLA, BOB, ALICE]);
  });
});

describe('nextEscalationTarget', () => {
  it('picks the level above the current approver', () => {
    expect(
      nextEscalationTarget({
        chain: [BOB, CARLA, DEV],
        currentApproverUserId: BOB,
        requesterUserId: ALICE,
        alreadyRoutedUserIds: [BOB],
      }),
    ).toBe(CARLA);
  });

  it('skips anyone who has already had the request', () => {
    expect(
      nextEscalationTarget({
        chain: [BOB, CARLA, DEV],
        currentApproverUserId: BOB,
        requesterUserId: ALICE,
        alreadyRoutedUserIds: [BOB, CARLA],
      }),
    ).toBe(DEV);
  });

  it('never escalates a request to the person who raised it', () => {
    expect(
      nextEscalationTarget({
        chain: [BOB, ALICE],
        currentApproverUserId: BOB,
        requesterUserId: ALICE,
        alreadyRoutedUserIds: [BOB],
      }),
    ).toBeNull();
  });

  it('returns null at the top of the chain rather than closing the request', () => {
    expect(
      nextEscalationTarget({
        chain: [BOB],
        currentApproverUserId: BOB,
        requesterUserId: ALICE,
        alreadyRoutedUserIds: [BOB],
      }),
    ).toBeNull();
  });

  /**
   * The reporting line changed after the request was raised, so the current
   * approver is no longer anywhere in it. Falling back to the whole chain
   * beats leaving the request stuck with nobody above it.
   */
  it('considers the whole chain when the current approver has left it', () => {
    expect(
      nextEscalationTarget({
        chain: [CARLA, DEV],
        currentApproverUserId: BOB,
        requesterUserId: ALICE,
        alreadyRoutedUserIds: [BOB],
      }),
    ).toBe(CARLA);
  });
});

describe('isStale', () => {
  const started = new Date('2026-08-01T09:00:00.000Z');

  it('is false before the threshold', () => {
    expect(
      isStale({
        now: new Date('2026-08-03T08:59:00.000Z'),
        currentStepStartedAt: started,
        escalateAfterDays: 3,
      }),
    ).toBe(false);
  });

  it('is true on the threshold', () => {
    expect(
      isStale({
        now: new Date('2026-08-04T09:00:00.000Z'),
        currentStepStartedAt: started,
        escalateAfterDays: 3,
      }),
    ).toBe(true);
  });

  // 0 is how a request opts out; a negative value is nonsense and must not be
  // read as "escalate immediately".
  it.each([0, -1])('never escalates when the threshold is %i', (escalateAfterDays) => {
    expect(
      isStale({
        now: new Date('2027-01-01T00:00:00.000Z'),
        currentStepStartedAt: started,
        escalateAfterDays,
      }),
    ).toBe(false);
  });

  it('measures from the current step, not from the request', () => {
    // Raised a week ago, but the step it is on started an hour ago.
    expect(
      isStale({
        now: new Date('2026-08-08T10:00:00.000Z'),
        currentStepStartedAt: new Date('2026-08-08T09:00:00.000Z'),
        escalateAfterDays: 3,
      }),
    ).toBe(false);
  });
});

describe('daysBetween', () => {
  it('floors a partial day rather than rounding it up', () => {
    expect(
      daysBetween(new Date('2026-08-01T00:00:00Z'), new Date('2026-08-02T23:59:00Z')),
    ).toBe(1);
  });

  it('is negative when the clock went backwards', () => {
    expect(
      daysBetween(new Date('2026-08-05T00:00:00Z'), new Date('2026-08-01T00:00:00Z')),
    ).toBe(-4);
  });
});
