import { useRef, useState } from 'react';
import { ImageIcon, TrashIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { toast } from '@/components/ui/toast';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  LOGO_ACCEPTED_TYPES,
  prepareLogo,
  useBrandingStore,
} from '@/lib/branding/branding-store';

interface OrgLogoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown next to the preview so the fallback is visible before committing. */
  monogram: string;
}

/**
 * REQ-L-01: the organisation logo.
 *
 * There is no shadcn file-upload primitive — the registry was checked — so
 * this composes Dialog and Button around a hidden native input, which is the
 * only way to open a file picker. Per CLAUDE.md §3 rule 1 a missing primitive
 * is composed once and kept in components/shared/ rather than re-invented per
 * screen.
 */
export function OrgLogoDialog({ open, onOpenChange, monogram }: OrgLogoDialogProps) {
  const logoDataUrl = useBrandingStore((s) => s.logoDataUrl);
  const setLogo = useBrandingStore((s) => s.setLogo);
  const clearLogo = useBrandingStore((s) => s.clearLogo);

  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = pending ?? logoDataUrl;

  async function onFileChosen(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const result = await prepareLogo(file);
      if (typeof result === 'string') {
        setPending(result);
      } else {
        // Errors say what happened and what to do (PRD §6.6).
        toast.add({
          type: 'error',
          title: 'That image could not be used',
          description: result.reason,
        });
      }
    } finally {
      setBusy(false);
      // Reset so choosing the same file twice still fires a change event.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function save() {
    if (!pending) return;
    setLogo(pending);
    setPending(null);
    onOpenChange(false);
    toast.add({ type: 'success', title: 'Logo updated' });
  }

  function remove() {
    clearLogo();
    setPending(null);
    onOpenChange(false);
    toast.add({ type: 'success', title: 'Logo removed' });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setPending(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Organisation logo</DialogTitle>
          <DialogDescription>
            Shown in the sidebar and on exported reports. PNG, JPEG or WebP, up to 2 MB. It is
            resized to 128px and re-encoded before it is stored.
          </DialogDescription>
        </DialogHeader>

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
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? <ImageIcon /> : <UploadSimpleIcon />}
              {busy ? 'Reading image' : 'Choose image'}
            </Button>
            <p className="text-muted-foreground text-xs">
              A square mark reads best. Wider images are fitted, never cropped.
            </p>
          </div>
        </div>

        <DialogFooter>
          {logoDataUrl ? (
            <Button variant="ghost" onClick={remove}>
              <TrashIcon />
              Remove
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => {
              setPending(null);
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button disabled={!pending} onClick={save}>
            Save logo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
