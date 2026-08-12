import { useState } from 'react';
import { PlugsIcon, XIcon } from '@phosphor-icons/react';

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * Says out loud that the rows below are invented.
 *
 * The screens in this module are finished ahead of their endpoints, so they
 * fall back to a sample payload in development (see `api.ts`). The one thing
 * that must never happen is somebody reading a number off one of these screens
 * and believing it. Hence: always visible on arrival, never suppressed by a
 * previous dismissal, and worded so it names the cause rather than apologising.
 *
 * Dismissable because the notice sits above the content it describes and a
 * reviewer looking at layout needs it out of the way; the dismissal lasts as
 * long as the screen and no longer.
 */
export function SampleDataNotice({ what }: { what: string }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <Alert>
      <PlugsIcon />
      <AlertTitle>Showing sample data</AlertTitle>
      <AlertDescription>
        The {what} endpoint is not connected yet, so this screen is filled with invented records.
        Nothing here is real and nothing you do here is saved.
      </AlertDescription>
      <AlertAction>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss the sample data notice"
          onClick={() => {
            setDismissed(true);
          }}
        >
          <XIcon />
        </Button>
      </AlertAction>
    </Alert>
  );
}
