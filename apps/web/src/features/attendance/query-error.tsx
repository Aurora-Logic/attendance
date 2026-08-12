import { WarningCircleIcon } from '@phosphor-icons/react';

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';

/**
 * The error state, once, for every screen in this module.
 *
 * PRD §6.6: errors say what happened and what to do. That means mapping the
 * error *code* rather than string-matching the message (technical design §6),
 * and it means separating "the server refused" from "the server is not there",
 * because those send the reader to two different places.
 */

interface ErrorCopy {
  title: string;
  description: string;
}

function attendanceErrorCopy(error: unknown, subject: string): ErrorCopy {
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
        description:
          'The server has nothing at this address yet. Nothing is wrong with this screen; there is nothing for it to read.',
      };
    case 'FORBIDDEN':
    case 'OUT_OF_SCOPE':
      return {
        title: `You cannot view these ${subject} records`,
        description:
          'This shows only the people in your scope. Ask an administrator to widen it.',
      };
    case 'TOKEN_EXPIRED':
    case 'TOKEN_INVALID':
      return {
        title: 'Your session has ended',
        description: 'Sign in again to carry on.',
      };
    case 'PERIOD_LOCKED':
      return {
        title: 'This period is locked',
        description: 'A locked month cannot change. Ask HR to unlock it if a correction is needed.',
      };
    default:
      return { title: `Could not load ${subject}`, description: error.message };
  }
}

export function QueryErrorAlert({
  error,
  subject,
  onRetry,
}: {
  error: unknown;
  subject: string;
  onRetry: () => void;
}) {
  const copy = attendanceErrorCopy(error, subject);

  return (
    <Alert variant="destructive">
      <WarningCircleIcon />
      <AlertTitle>{copy.title}</AlertTitle>
      <AlertDescription>
        {copy.description}
        {/* The request id is what turns "it failed for me" into something
            findable in the server log, so it is printed rather than swallowed. */}
        {error instanceof ApiError && error.requestId ? (
          <span className="mt-1 block font-mono text-[0.6875rem]">Request {error.requestId}</span>
        ) : null}
      </AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </AlertAction>
    </Alert>
  );
}
