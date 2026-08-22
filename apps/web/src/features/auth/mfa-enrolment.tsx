import { useEffect, useState } from 'react';
import { CheckIcon, CopyIcon, WarningCircleIcon } from '@phosphor-icons/react';
import QRCode from 'qrcode';

import { Form } from '@/components/shared/form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api/client';

import { SubmitLabel } from './auth-shell';
import { RecoveryCodesPdf } from './recovery-sheet';
import { useConfirmMfa, useStartMfaEnrolment } from './use-mfa';

/**
 * REQ-B-09: setting up an authenticator, in two steps on one surface. First
 * the secret -- a QR to scan, and the same secret as text for an app that
 * cannot -- and the first code, which is what proves the app holds it.
 * Then the recovery codes, shown once; the person confirms they have them
 * before the surface closes, because there is no second showing.
 *
 * Used twice: on the profile, by choice, and as the screen a person whose
 * role requires it lands on after sign-in, before anything else.
 */
export function MfaEnrolment({ onDone }: { onDone: () => void }) {
  const start = useStartMfaEnrolment();
  const confirm = useConfirmMfa();
  const [code, setCode] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (start.isIdle) start.mutate();
    // Start once on mount; the mutation object is stable enough for this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const uri = start.data?.otpauthUri;
    if (uri === undefined) return;
    let cancelled = false;
    void QRCode.toDataURL(uri, { margin: 1, width: 192 }).then((url) => {
      if (!cancelled) setQr(url);
    });
    return () => {
      cancelled = true;
    };
  }, [start.data?.otpauthUri]);

  const problem = confirm.error instanceof ApiError ? confirm.error.message : confirm.error ? 'Something went wrong. Try again.' : null;

  if (confirm.isSuccess) {
    return <RecoveryCodes codes={confirm.data.codes} saved={saved} onSavedChange={setSaved} onDone={onDone} />;
  }

  return (
    <div className="flex flex-col gap-5">
      <ol className="text-muted-foreground flex flex-col gap-1 text-sm">
        <li>1. Open your authenticator app (Google Authenticator, Authy, 1Password, Microsoft Authenticator).</li>
        <li>2. Scan the square, or type the key.</li>
        <li>3. Enter the six-digit code the app shows.</li>
      </ol>

      {start.isError ? (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>Could not start the set-up</AlertTitle>
          <AlertDescription>
            {start.error instanceof ApiError ? start.error.message : 'Try again.'}
            <Button variant="outline" size="sm" className="mt-2" onClick={() => { start.mutate(); }}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col items-start gap-4 sm:flex-row">
        {/* The square is white on purpose, in both themes: a QR is read by a
            camera, and a dark surface behind it halves the contrast the scan
            depends on. */}
        {qr === null ? (
          <Skeleton className="size-48 shrink-0" aria-label="Preparing the square to scan" />
        ) : (
          <img src={qr} alt="Scan this with your authenticator app" width={192} height={192} className="size-48 shrink-0 border bg-white" />
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs font-medium">Or type this key</p>
          {start.data === undefined ? (
            <Skeleton className="h-5 w-56" />
          ) : (
            <code className="bg-muted px-2 py-1 font-mono text-xs tracking-wider break-all select-all">{groupBase32(start.data.secret)}</code>
          )}
          <p className="text-muted-foreground text-xs">Time-based, six digits, every thirty seconds.</p>
        </div>
      </div>

      <Form
        onSubmit={(event) => {
          event.preventDefault();
          if (code.trim().length === 0 || confirm.isPending) return;
          confirm.mutate({ code: code.trim() });
        }}
      >
        <FieldGroup>
          <Field data-invalid={problem ? true : undefined}>
            <FieldLabel htmlFor="mfa-enrol-code">Code from the app</FieldLabel>
            <Input
              id="mfa-enrol-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="123456"
              className="w-40 font-mono text-base tracking-[0.3em]"
              value={code}
              aria-invalid={problem ? true : undefined}
              onChange={(event) => {
                setCode(event.target.value.replace(/\D/gu, ''));
              }}
            />
            <FieldDescription>{problem ?? 'The first correct code turns two-step sign-in on.'}</FieldDescription>
          </Field>
          <Button type="submit" disabled={start.data === undefined} className="w-full sm:w-auto sm:self-start">
            <SubmitLabel state={confirm.isPending ? 'pending' : 'idle'}>
              {confirm.isPending ? <Spinner data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
              {confirm.isPending ? 'Checking' : 'Turn on'}
            </SubmitLabel>
          </Button>
        </FieldGroup>
      </Form>
    </div>
  );
}

/** "JBSWY3DPEHPK3PXP" reads as four groups; the app accepts either. */
function groupBase32(secret: string): string {
  return secret.replace(/(.{4})/gu, '$1 ').trim();
}

export function RecoveryCodes({ codes, saved, onSavedChange, onDone, lead }: { codes: readonly string[]; saved: boolean; onSavedChange: (next: boolean) => void; onDone: () => void; lead?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      // `navigator.clipboard` is absent over plain http; the codes are still on screen.
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Your recovery codes</p>
        <p className="text-muted-foreground text-sm">
          {lead ?? 'If you lose your phone, one of these signs you in instead of a code. Each works once. They are shown now and never again; keep them somewhere that is not the phone.'}
        </p>
      </div>
      <ol className="grid grid-cols-2 gap-x-6 gap-y-1 border p-3 font-mono text-sm tabular-nums select-all sm:grid-cols-2">
        {codes.map((recoveryCode) => (
          <li key={recoveryCode}>{recoveryCode}</li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <RecoveryCodesPdf codes={codes} />
        <Button variant="outline" onClick={() => { void copy(); }}>
          {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
          {copied ? 'Copied' : 'Copy all'}
        </Button>
        <Button
          variant={saved ? 'default' : 'outline'}
          aria-pressed={saved}
          onClick={() => {
            onSavedChange(!saved);
          }}
        >
          <CheckIcon data-icon="inline-start" />
          I have saved these
        </Button>
        <Button disabled={!saved} onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
