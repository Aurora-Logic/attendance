import { useState } from 'react';
import { FlaskIcon, XIcon } from '@phosphor-icons/react';

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface SampleDataNoticeProps {
  /** The path that answered "no such thing", named so the reader can check it. */
  endpoint: string;
}

/**
 * Says out loud that the rows on screen are fixtures rather than records.
 *
 * Rendered only when a query fell back (see `dev-fixture-fallback.ts`), which
 * can only happen in development against an endpoint the server does not
 * serve. Delete this component and its call sites when the endpoints land.
 *
 * Dismissable, because someone demonstrating the screen should be able to get
 * it out of the way; not remembered, because on the next load the data is
 * still fake and a notice that stayed dismissed would be the silent
 * fabrication this whole mechanism exists to avoid.
 */
export function SampleDataNotice({ endpoint }: SampleDataNoticeProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <Alert>
      <FlaskIcon />
      <AlertTitle>Sample data — this screen is not connected yet</AlertTitle>
      <AlertDescription>
        <span className="font-mono">{endpoint}</span> is not available on the server, so the rows
        below are development fixtures. Nothing here is real, and anything submitted from this
        screen will fail rather than save.
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
