import { useRef, useState } from 'react';
import { ImageIcon, TrashIcon, UploadSimpleIcon, WarningCircleIcon } from '@phosphor-icons/react';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api/client';
import {
  LOGO_ACCEPTED_TYPES,
  isRejection,
  prepareLogo,
  type PreparedLogo,
} from '@/lib/branding/logo-image';
import { useBranding, useRemoveLogo, useUploadLogo } from '@/lib/branding/use-branding';

interface OrgLogoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown next to the preview so the fallback is visible before committing. */
  monogram: string;
}

/**
 * REQ-L-01: the organisation logo.
 *
 * There is no shadcn file-upload primitive — the registry was checked — so this
 * composes Dialog and Button around a hidden native input, which is the only
 * way to open a file picker. Per CLAUDE.md §3 rule 1 a missing primitive is
 * composed once and kept in components/shared/ rather than re-invented per
 * screen.
 *
 * It now saves to the server rather than to localStorage (P0-7). The visible
 * difference is that everybody in the organisation sees the result; the
 * invisible one is that the bytes go through the same magic-byte sniff and the
 * same re-encode as a punch photo, so the image the server keeps was written
 * from decoded pixels rather than from anything a client sent.
 */
export function OrgLogoDialog({ open, onOpenChange, monogram }: OrgLogoDialogProps) {
  const branding = useBranding();
  const upload = useUploadLogo();
  const remove = useRemoveLogo();

  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PreparedLogo | null>(null);
  const [reading, setReading] = useState(false);

  const stored = branding.data?.logoUrl ?? null;
  const preview = pending?.previewUrl ?? stored;
  const busy = upload.isPending || remove.isPending;

  async function onFileChosen(file: File | undefined) {
    if (!file) return;
    setReading(true);
    try {
      const result = await prepareLogo(file);
      if (isRejection(result)) {
        // Errors say what happened and what to do (PRD §6.6).
        toast.add({
          type: 'error',
          title: 'That image could not be used',
          description: result.reason,
        });
      } else {
        setPending(result);
      }
    } finally {
      setReading(false);
      // Reset so choosing the same file twice still fires a change event.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function close() {
    setPending(null);
    upload.reset();
    remove.reset();
    onOpenChange(false);
  }

  function save() {
    if (!pending) return;
    upload.mutate(pending.blob, {
      onSuccess: () => {
        toast.add({
          type: 'success',
          title: 'Logo updated',
          description: 'Everybody in the organisation sees it from their next page load.',
        });
        close();
      },
      // No error toast: the failure is rendered inside the dialog, above the
      // button that did not work, rather than in a corner.
    });
  }

  function clear() {
    remove.mutate(undefined, {
      onSuccess: () => {
        toast.add({ type: 'success', title: 'Logo removed' });
        close();
      },
    });
  }

  const failure = upload.error ?? remove.error;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPending(null);
          upload.reset();
          remove.reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Organisation logo</DialogTitle>
          <DialogDescription>
            Shown in the sidebar for everybody signed in. PNG, JPEG or WebP, up to 2 MB. It is
            resized to 128px and re-encoded on the server before it is stored.
          </DialogDescription>
        </DialogHeader>

        {failure != null ? (
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle>
              {failure instanceof ApiError && failure.code === 'NETWORK_ERROR'
                ? 'Could not reach the server'
                : 'That did not save'}
            </AlertTitle>
            <AlertDescription>
              {failure instanceof ApiError
                ? failure.message
                : 'Nothing changed. Try again, or choose a different image.'}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-center gap-4">
          <div className="bg-muted text-muted-foreground flex size-16 shrink-0 items-center justify-center overflow-hidden border">
            {preview ? (
              <img src={preview} alt="" className="size-full object-contain" />
            ) : (
              <span className="text-primary text-xl font-semibold">{monogram}</span>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            {/*
              The only raw control in feature code, and only because the
              platform provides no other way to open a file picker. It is
              visually hidden and driven by the button beside it, so the button
              is what receives focus and keyboard activation.
            */}
            {/* eslint-disable-next-line no-restricted-syntax */}
            <input
              ref={inputRef}
              type="file"
              accept={LOGO_ACCEPTED_TYPES.join(',')}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(event) => {
                void onFileChosen(event.target.files?.[0]);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={reading || busy}
              onClick={() => inputRef.current?.click()}
            >
              {reading ? <ImageIcon data-icon="inline-start" /> : <UploadSimpleIcon data-icon="inline-start" />}
              {reading ? 'Reading image' : 'Choose image'}
            </Button>
            <p className="text-muted-foreground text-xs">
              A square mark reads best. Wider images are fitted, never cropped.
            </p>
          </div>
        </div>

        {/* Three short actions fit one row at 360px, so they stay in one row
            rather than stacking and putting the primary furthest from the
            thumb. */}
        <DialogFooter className="flex-row justify-end gap-2">
          {stored !== null && pending === null ? (
            <Button
              variant="ghost"
              className="mr-auto"
              disabled={busy}
              onClick={clear}
            >
              {remove.isPending ? <Spinner data-icon="inline-start" /> : <TrashIcon data-icon="inline-start" />}
              {remove.isPending ? 'Removing' : 'Remove'}
            </Button>
          ) : null}
          <Button variant="outline" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={pending === null || busy}
            onClick={save}
          >
            {upload.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <ACTION_ICONS.save data-icon="inline-start" />
            )}
            {upload.isPending ? 'Saving' : 'Save logo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
