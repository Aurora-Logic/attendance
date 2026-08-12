import { ApiError } from '@/lib/api/client';

/**
 * What a reader is told when a Phase 2 screen cannot load, and what to do
 * next (PRD §6.6: errors say what happened and what to do).
 *
 * One function rather than one per screen, because the three screens differ
 * only in the noun and the permission they need — and because three copies of
 * this switch would drift apart the first time a code was added.
 */

interface ErrorCopyInput {
  /** Lower case, plural, as it reads mid-sentence: "leave balances". */
  subject: string;
  /** The permission an administrator would have to grant. */
  permission: string;
}

export interface ErrorCopy {
  title: string;
  description: string;
}

export function apiErrorCopy(error: unknown, { subject, permission }: ErrorCopyInput): ErrorCopy {
  if (!(error instanceof ApiError)) {
    return {
      title: `Could not load ${subject}`,
      description: 'Something went wrong on the way. Try again.',
    };
  }

  switch (error.code) {
    case 'NETWORK_ERROR':
      return {
        title: 'Could not reach the server',
        description: 'Check that the API is running, then try again.',
      };
    case 'NOT_FOUND':
      return {
        title: `The ${subject} endpoint is not available`,
        description: `The server has nothing at this address yet. Nothing is wrong with this screen; there is nothing for it to read.`,
      };
    case 'FORBIDDEN':
    case 'OUT_OF_SCOPE':
      return {
        title: `You cannot view these ${subject}`,
        description: `This needs the ${permission} permission. Ask an administrator to grant it.`,
      };
    case 'TOKEN_EXPIRED':
    case 'TOKEN_INVALID':
      return {
        title: 'Your session has ended',
        description: 'Sign in again to carry on.',
      };
    default:
      return { title: `Could not load ${subject}`, description: error.message };
  }
}

/** The same treatment for an action that failed rather than a list that would not load. */
export function actionErrorCopy(error: unknown, action: string): ErrorCopy {
  if (error instanceof ApiError && error.code === 'NETWORK_ERROR') {
    return {
      title: `${action} failed`,
      description: 'The server could not be reached, so nothing was saved.',
    };
  }
  if (error instanceof ApiError && (error.code === 'NOT_FOUND' || error.status === 404)) {
    return {
      title: `${action} is not connected yet`,
      description: 'The endpoint does not exist on the server, so nothing was saved.',
    };
  }
  return {
    title: `${action} failed`,
    description: error instanceof Error ? error.message : 'Something went wrong. Try again.',
  };
}
