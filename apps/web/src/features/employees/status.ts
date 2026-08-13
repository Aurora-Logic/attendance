import { type EmployeeStatus } from '@vyuha/shared';

/**
 * REQ-A-05: how an employee record says which part of its lifecycle it is in.
 *
 * One definition, read by the register and by the detail screen, so a person
 * cannot be "On notice" in the list and "ON_NOTICE" on their own page
 * (CLAUDE.md §3 rule 4).
 */

export const STATUS_LABELS: Record<EmployeeStatus, string> = {
  ACTIVE: 'Active',
  ON_NOTICE: 'On notice',
  INACTIVE: 'Inactive',
};

/**
 * Active is the ordinary state and reads as unremarkable; on notice is the one
 * a manager needs to spot while scanning. Inactive is outlined so a
 * deactivated record is visibly present rather than looking like a live one
 * (REQ-A-05 keeps the history).
 */
export const STATUS_VARIANT: Record<EmployeeStatus, 'secondary' | 'default' | 'outline'> = {
  ACTIVE: 'secondary',
  ON_NOTICE: 'default',
  INACTIVE: 'outline',
};
