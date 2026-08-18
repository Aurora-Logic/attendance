import {
  ArrowCounterClockwiseIcon,
  KeyIcon,
  PencilSimpleIcon,
  UserMinusIcon,
} from '@phosphor-icons/react';

import type { EmployeeListItem } from '@vyuha/shared';

import type { RowAction } from '@/components/shared/row-actions';

import type { LifecycleTarget } from './lifecycle-dialog';

/**
 * What can be done to one employee, decided once.
 *
 * These rules are not arbitrary and they are not obvious: REQ-A-05 retires
 * somebody with a status *and* a last working date, an inactive person is
 * reactivated rather than retired again, and only an active person can be put
 * on notice. There is deliberately no delete — attendance rows point at the
 * employee, and removing the record would take the history the reports are
 * built on with it.
 *
 * It lives in its own file because the register and the person's own page both
 * offer them. Duplicated, the two would eventually disagree about which action
 * an on-notice employee gets, and the one nobody looks at would be the wrong
 * one.
 */
export function employeeActions(input: {
  employee: EmployeeListItem;
  canManage: boolean;
  onEdit: () => void;
  onLifecycle: (target: LifecycleTarget) => void;
  onInvite: () => void;
}): RowAction[] {
  const { employee, canManage, onEdit, onLifecycle, onInvite } = input;

  // Disabled with a reason rather than hidden. CLAUDE.md's Definition of Done
  // allows either, and a stated reason is what stops somebody filing a bug
  // about a menu that "does nothing".
  const blocked = canManage
    ? undefined
    : 'Needs the employee.manage permission, which your account does not hold.';
  const gate = blocked === undefined ? {} : { unavailableReason: blocked };

  const actions: RowAction[] = [
    {
      key: 'edit',
      label: 'Edit employee',
      icon: PencilSimpleIcon,
      onSelect: onEdit,
      ...gate,
    },
  ];

  /**
   * REQ-B-03, and the only place in the product an account can be created.
   *
   * Offered for anybody who is not retired, and offered *whatever* their
   * account state is: whether a login already exists is not on the row, and
   * fetching it per row would be one request per employee on a page of fifty.
   * The dialog reads it once, for the one person, and refuses with the reason
   * — which is also what the server does.
   *
   * Not offered for an inactive employee, because a retired person cannot
   * punch and has no business being handed a way in. Reactivate first.
   */
  if (employee.status !== 'INACTIVE') {
    actions.push({
      key: 'invite',
      label: 'Login credentials',
      icon: KeyIcon,
      onSelect: onInvite,
      ...gate,
    });
  }

  if (employee.status === 'INACTIVE') {
    actions.push({
      key: 'reactivate',
      label: 'Reactivate employee',
      icon: ArrowCounterClockwiseIcon,
      onSelect: () => {
        onLifecycle({ mode: 'reactivate', employee });
      },
      ...gate,
    });
    return actions;
  }

  if (employee.status === 'ACTIVE') {
    actions.push({
      key: 'notice',
      label: 'Put on notice',
      icon: UserMinusIcon,
      onSelect: () => {
        onLifecycle({ mode: 'notice', employee });
      },
      ...gate,
    });
  }

  actions.push({
    key: 'retire',
    label: 'Retire employee',
    icon: UserMinusIcon,
    destructive: true,
    onSelect: () => {
      onLifecycle({ mode: 'retire', employee });
    },
    ...gate,
  });

  return actions;
}
