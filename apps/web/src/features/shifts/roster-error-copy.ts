import { ApiError } from '@/lib/api/client';

/**
 * The refusals this slice can produce, worded for a reader.
 *
 * Technical design section 6: the client maps the error *code* and never
 * string-matches on `message`. The two codes below are the ones a roster
 * write can honestly return, and both send the reader somewhere different --
 * an overlap is fixed on this form, a locked period is fixed by somebody else.
 */

export interface ErrorCopy {
  title: string;
  description: string;
}

export function rosterErrorCopy(error: unknown): ErrorCopy {
  if (!(error instanceof ApiError)) {
    return {
      title: 'Could not save this assignment',
      description: 'Something went wrong on the way. Nothing was changed. Try again.',
    };
  }

  switch (error.code) {
    case 'SHIFT_ASSIGNMENT_OVERLAP':
      return {
        title: 'That period is already taken',
        description: overlapDetail(error),
      };
    case 'PERIOD_LOCKED':
      return {
        title: 'That period is locked',
        // The server's message already names the month, and repeating it here
        // in different words would be two statements of one fact that can
        // drift apart.
        description: error.message,
      };
    case 'VALIDATION_FAILED':
      return { title: 'Check the dates and the shift', description: error.message };
    case 'FORBIDDEN':
    case 'OUT_OF_SCOPE':
      return {
        title: 'You cannot roster this person',
        description: 'This screen covers only the people in your scope. Ask an administrator.',
      };
    case 'NETWORK_ERROR':
      return {
        title: 'Could not reach the server',
        description: 'Nothing was saved. Check that the API is running, then try again.',
      };
    default:
      return { title: 'Could not save this assignment', description: error.message };
  }
}

/**
 * Names the assignment in the way when the server sent its details. "It
 * overlaps" alone sends the reader hunting through a year of roster rows.
 */
function overlapDetail(error: ApiError): string {
  const details = error.details;
  if (details === undefined) return error.message;

  const shift = typeof details.conflictingShift === 'string' ? details.conflictingShift : null;
  const from = typeof details.conflictingFrom === 'string' ? details.conflictingFrom : null;
  const to = typeof details.conflictingTo === 'string' ? details.conflictingTo : null;

  if (shift === null || from === null) return error.message;
  return `They are already on ${shift} from ${from} ${to === null ? 'with no end date' : `to ${to}`}. End that assignment first, or pick a period outside it.`;
}
