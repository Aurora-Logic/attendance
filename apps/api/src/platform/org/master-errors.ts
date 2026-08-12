import { ERROR_CODES } from '@vyuha/shared';

import { AppError } from '../common/errors.js';

/**
 * The two refusals every master shares. Written once so the three resources
 * answer a duplicate code and a dangling reference with the same code and the
 * same detail shape -- the client maps codes, and a resource that invented its
 * own would need a special case in the form that submits it.
 */

export function codeTakenError(entity: string, code: string, cause?: unknown): AppError {
  return new AppError(ERROR_CODES.CONFLICT, `Another ${entity} already uses that code.`, {
    details: { code },
    ...(cause === undefined ? {} : { cause }),
  });
}

export function unknownReferenceError(field: string, id: string): AppError {
  return AppError.validation('One or more references do not exist in this organisation.', {
    fields: [{ path: field, message: 'no such record', value: id }],
  });
}
