import { ArrowClockwiseIcon, VideoCameraSlashIcon } from '@phosphor-icons/react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

import type { Camera } from './use-camera';

/**
 * The live preview, and the one place that explains why there is no upload
 * button (REQ-D-02).
 *
 * Every failure state here says what to do and offers a retry. None of them
 * offers an alternative way to supply a photo, because there is not one and
 * inventing one would remove the control the photo exists to provide. The copy
 * says so plainly rather than leaving somebody hunting for a hidden option.
 */

const BLOCKED_COPY: Record<
  Exclude<Camera['state'], 'ready' | 'starting'>,
  { title: string; body: string }
> = {
  denied: {
    title: 'Camera blocked',
    body: 'Allow the camera for this site in your browser settings, then try again. A punch needs a live photo, so there is no way to continue without it.',
  },
  unavailable: {
    title: 'No front camera',
    body: 'A punch is photographed with the front camera. A rear or external camera cannot be used, and a photo from your gallery cannot be either.',
  },
  insecure: {
    title: 'Camera unavailable on this connection',
    body: 'Browsers only release the camera over HTTPS. Open this site over a secure connection and try again.',
  },
};

type BlockedState = keyof typeof BLOCKED_COPY;

/** Narrowed rather than indexed, so a new CameraState cannot silently fall through. */
function blockedCopy(state: Camera['state']): (typeof BLOCKED_COPY)[BlockedState] | null {
  return state === 'ready' || state === 'starting' ? null : BLOCKED_COPY[state];
}

export function CameraPanel({ camera, className }: { camera: Camera; className?: string }) {
  // Destructured rather than read as `camera.state` throughout: once one
  // member of an object is passed to a JSX `ref`, the react-hooks rules treat
  // every property read on that object as reading a ref during render.
  const { state, attachVideo, retry, detail } = camera;
  const blocked = blockedCopy(state);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* A fixed 4:3 box. The stream arrives asynchronously and often at a
          different aspect ratio from the last one, so reserving the space
          stops the primary action jumping under a thumb that is already
          moving toward it.
          Landscape even on a phone, where the camera itself is portrait: the
          box only frames the preview - `capture()` reads the full video frame
          - and a 3:4 box at 360px is 437px tall, which pushed the half-day
          switch and the reason field below the fold. */}
      <div className="bg-muted relative aspect-4/3 w-full overflow-hidden border">
        {/* Always mounted, so the ref exists when the stream is attached.
            Hidden rather than unmounted while starting. `muted` and
            `playsInline` are what let iOS Safari autoplay it at all. */}
        <video
          ref={attachVideo}
          muted
          playsInline
          autoPlay
          aria-label="Live camera preview"
          className={cn(
            'size-full object-cover',
            // Mirrored, because an unmirrored front camera reads as somebody
            // else's face and people move the wrong way to centre themselves.
            '-scale-x-100',
            state === 'ready' ? 'opacity-100' : 'opacity-0',
          )}
        />

        {state === 'starting' ? (
          <div className="text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs">
            <Spinner />
            Starting the camera
          </div>
        ) : null}

        {blocked ? (
          <div className="text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-xs">
            <VideoCameraSlashIcon aria-hidden className="size-8" />
            No preview
          </div>
        ) : null}
      </div>

      {blocked ? (
        <Alert variant="destructive">
          <VideoCameraSlashIcon />
          <AlertTitle>{blocked.title}</AlertTitle>
          <AlertDescription>
            {blocked.body}
            {detail ? (
              <span className="mt-1 block text-[0.6875rem]">{detail}</span>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="pointer-coarse:h-11 mt-2"
              onClick={retry}
            >
              <ArrowClockwiseIcon data-icon="inline-start" />
              Try the camera again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
