import { useState } from 'react';
import { ArrowLeftIcon, ShieldCheckIcon, WarningCircleIcon } from '@phosphor-icons/react';

import { Form } from '@/components/shared/form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api/client';

import { SubmitLabel } from './auth-shell';
import { useCompleteMfa } from './use-mfa';

/**
 * REQ-B-09: the code step after the password. One field, autofocused, that
 * takes the six digits or -- behind "use a recovery code" -- a recovery
 * code; a box to remember this browser for thirty days; a way back to the
 * password when the phone is not to hand. The challenge expires in five
 * minutes or after five wrong codes, and the server's message says which.
 */
export function MfaStep({ challengeToken, onBack }: { challengeToken: string; onBack: () => void }) {
  const complete = useCompleteMfa();
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(true);
  const [recovery, setRecovery] = useState(false);

  const error = complete.error;
  const expired = error instanceof ApiError && error.code === 'MFA_CHALLENGE_EXPIRED';
  const problem = error instanceof ApiError ? error.message : error ? 'Something went wrong. Try again.' : null;

  return (
    <div className="flex flex-col gap-5">
      {expired ? (
        <Alert variant="destructive" aria-live="assertive">
          <WarningCircleIcon />
          <AlertTitle>That code step has expired</AlertTitle>
          <AlertDescription>
            {problem}
            <Button variant="outline" size="sm" className="mt-2" onClick={onBack}>
              <ArrowLeftIcon data-icon="inline-start" />
              Back to the password
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Form
        onSubmit={(event) => {
          event.preventDefault();
          if (expired || complete.isPending || code.trim().length === 0) return;
          complete.mutate({ challengeToken, code: code.trim(), trustDevice });
        }}
      >
        <FieldGroup>
          <Field data-invalid={problem && !expired ? true : undefined}>
            <FieldLabel htmlFor="mfa-code">{recovery ? 'Recovery code' : 'Code from your authenticator app'}</FieldLabel>
            <Input
              id="mfa-code"
              autoFocus
              inputMode={recovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              autoCapitalize={recovery ? 'characters' : 'none'}
              spellCheck={false}
              maxLength={recovery ? 11 : 6}
              placeholder={recovery ? 'ABCDE-FGHJK' : '123456'}
              className="font-mono text-base tracking-[0.3em]"
              value={code}
              aria-invalid={problem && !expired ? true : undefined}
              onChange={(event) => {
                setCode(recovery ? event.target.value.toUpperCase() : event.target.value.replace(/\D/gu, ''));
              }}
            />
            <FieldDescription>
              {problem && !expired ? problem : recovery ? 'One of the ten codes you saved when you set this up. Each works once.' : 'Six digits; the app shows a new one every thirty seconds.'}
            </FieldDescription>
          </Field>

          <div className="flex items-center gap-2">
            <Checkbox
              id="mfa-trust"
              checked={trustDevice}
              onCheckedChange={(next) => {
                setTrustDevice(next === true);
              }}
            />
            <Label htmlFor="mfa-trust" className="font-normal">
              Remember this browser for 30 days
            </Label>
          </div>

          <Button type="submit" className="w-full" disabled={expired}>
            <SubmitLabel state={complete.isPending ? 'pending' : 'idle'}>
              {complete.isPending ? <Spinner data-icon="inline-start" /> : <ShieldCheckIcon data-icon="inline-start" />}
              {complete.isPending ? 'Checking' : 'Continue'}
            </SubmitLabel>
          </Button>
        </FieldGroup>
      </Form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="link"
          size="sm"
          className="px-0"
          onClick={() => {
            setRecovery((value) => !value);
            setCode('');
          }}
        >
          {recovery ? 'Use the app instead' : 'Use a recovery code'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeftIcon data-icon="inline-start" />
          Back
        </Button>
      </div>
    </div>
  );
}
