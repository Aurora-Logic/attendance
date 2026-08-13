import type { LeaveTypeInput } from '@vyuha/shared';

/**
 * REQ-G-02's five seed types.
 *
 * **Every number below is a placeholder, not a policy.** OPEN-QUESTIONS item 4
 * records that entitlement, carry-forward cap, negative limit, notice days and
 * the document rule are all unanswered, and lists "the five seed types from
 * REQ-G-02 with placeholder values" as the agreed stand-in. Nothing here has
 * been inferred from anything, and no code branches on these values -- they
 * are seed rows, editable in the UI the moment the real ones arrive.
 *
 * The one number that is *not* a placeholder is the comp-off entitlement,
 * which is zero on purpose: a comp-off balance comes from worked days
 * (REQ-G-11), never from an accrual, and an entitlement on that type would
 * hand out days nobody earned.
 */

export interface SeedLeaveType extends LeaveTypeInput {
  /** Rendered wherever the type is edited, so the placeholder is visible. */
  readonly placeholderNote: string;
}

const PLACEHOLDER = 'Placeholder value; the real policy is OPEN-QUESTIONS item 4.';

export const SEED_LEAVE_TYPES: readonly SeedLeaveType[] = [
  {
    name: 'Casual Leave',
    code: 'CL',
    isPaid: true,
    accrualMethod: 'MONTHLY',
    annualEntitlement: 12,
    carryForwardAllowed: false,
    carryForwardCap: null,
    negativeBalanceLimit: 0,
    isEncashable: false,
    allowsHalfDay: true,
    minDays: null,
    maxDays: null,
    noticeDays: 0,
    attachmentRequiredAfterDays: null,
    countsSandwichDays: false,
    requiresTwoStepApproval: false,
    applicableEmploymentTypes: [],
    isActive: true,
    placeholderNote: PLACEHOLDER,
  },
  {
    name: 'Sick Leave',
    code: 'SL',
    isPaid: true,
    accrualMethod: 'YEARLY',
    annualEntitlement: 12,
    carryForwardAllowed: false,
    carryForwardCap: null,
    negativeBalanceLimit: 0,
    isEncashable: false,
    allowsHalfDay: true,
    minDays: null,
    maxDays: null,
    noticeDays: 0,
    attachmentRequiredAfterDays: 3,
    countsSandwichDays: false,
    requiresTwoStepApproval: false,
    applicableEmploymentTypes: [],
    isActive: true,
    placeholderNote: PLACEHOLDER,
  },
  {
    name: 'Earned Leave',
    code: 'EL',
    isPaid: true,
    accrualMethod: 'MONTHLY',
    annualEntitlement: 15,
    carryForwardAllowed: true,
    carryForwardCap: 30,
    negativeBalanceLimit: 0,
    isEncashable: true,
    allowsHalfDay: true,
    minDays: null,
    maxDays: null,
    noticeDays: 7,
    attachmentRequiredAfterDays: null,
    countsSandwichDays: true,
    requiresTwoStepApproval: false,
    applicableEmploymentTypes: [],
    isActive: true,
    placeholderNote: PLACEHOLDER,
  },
  {
    name: 'Leave Without Pay',
    code: 'LWP',
    isPaid: false,
    accrualMethod: 'NONE',
    annualEntitlement: 0,
    carryForwardAllowed: false,
    carryForwardCap: null,
    // Unpaid leave has no balance to run down, so it must be allowed to go
    // negative without limit -- and REQ-G-08 spells 0 as "not allowed", not
    // as "unlimited". This is the highest value the column can hold.
    negativeBalanceLimit: 9999.99,
    isEncashable: false,
    allowsHalfDay: true,
    minDays: null,
    maxDays: null,
    noticeDays: 0,
    attachmentRequiredAfterDays: null,
    countsSandwichDays: true,
    requiresTwoStepApproval: false,
    applicableEmploymentTypes: [],
    isActive: true,
    placeholderNote: PLACEHOLDER,
  },
  {
    name: 'Compensatory Off',
    code: 'CO',
    isPaid: true,
    // Not a placeholder: comp-off is earned by working (REQ-G-11), so it
    // accrues from credits and never from a schedule.
    accrualMethod: 'NONE',
    annualEntitlement: 0,
    carryForwardAllowed: false,
    carryForwardCap: null,
    negativeBalanceLimit: 0,
    isEncashable: false,
    allowsHalfDay: true,
    minDays: null,
    maxDays: null,
    noticeDays: 0,
    attachmentRequiredAfterDays: null,
    countsSandwichDays: false,
    requiresTwoStepApproval: false,
    applicableEmploymentTypes: [],
    isActive: true,
    placeholderNote: 'Earned from worked holidays and weekly offs; never accrued on a schedule.',
  },
];
