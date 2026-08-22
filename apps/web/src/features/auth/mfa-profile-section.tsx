import { useState } from 'react';
import { DevicesIcon, KeyIcon, ShieldCheckIcon, ShieldIcon, TrashIcon } from '@phosphor-icons/react';

import { Form } from '@/components/shared/form';
import { SectionHeading } from '@/components/shared/section-heading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format';

import { SubmitLabel } from './auth-shell';
import { MfaEnrolment, RecoveryCodes } from './mfa-enrolment';
import { useDisableMfa, useMfaStatus, useRegenerateRecoveryCodes, useRevokeTrustedDevice } from './use-mfa';

/**
 * REQ-B-09 on the profile: whether two-step sign-in is on, the way to turn
 * it on (a sheet with the enrolment), and when it is on, the recovery codes
 * left, the browsers remembered, and the two things that need a code --
 * new recovery codes and turning it off. A person whose role requires it
 * sees that it is required and cannot turn it off from here.
 */
export function MfaProfileSection() {
  const status = useMfaStatus();
  const isMobile = useIsMobile();
  const [enrolOpen, setEnrolOpen] = useState(false);
  const [codesOpen, setCodesOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading
        title="Two-step sign-in"
        note="A six-digit code from an authenticator app after your password."
        action={
          status.data?.enabled === true ? (
            <Badge variant="secondary">
              <ShieldCheckIcon data-icon="inline-start" />
              On
            </Badge>
          ) : null
        }
      />

      {status.isPending ? <Skeleton className="h-20 w-full" /> : null}

      {status.isError ? (
        <p className="text-destructive text-sm">{status.error instanceof ApiError ? status.error.message : 'Could not read the two-step status.'}</p>
      ) : null}

      {status.isSuccess && !status.data.enabled ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            {status.data.required ? 'Your role requires it.' : 'Off. Anyone may turn it on; it protects the account if the password leaks.'}
          </p>
          <Button size="sm" className="self-start" onClick={() => { setEnrolOpen(true); }}>
            <ShieldIcon data-icon="inline-start" />
            Turn on
          </Button>
        </div>
      ) : null}

      {status.isSuccess && status.data.enabled ? (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Since</dt>
            <dd className="tabular-nums">{status.data.confirmedAt ? formatDate(status.data.confirmedAt.slice(0, 10)) : '—'}</dd>
            <dt className="text-muted-foreground">Recovery codes left</dt>
            <dd className="tabular-nums">{status.data.recoveryCodesLeft} of 10</dd>
            <dt className="text-muted-foreground">Required</dt>
            <dd>{status.data.required ? 'Yes, by your role' : 'No, your choice'}</dd>
          </dl>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { setCodesOpen(true); }}>
              <KeyIcon data-icon="inline-start" />
              New recovery codes
            </Button>
            {status.data.required ? null : (
              <Button variant="outline" size="sm" onClick={() => { setDisableOpen(true); }}>
                <ShieldIcon data-icon="inline-start" />
                Turn off
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <SectionHeading title="Remembered browsers" note="Each skips the code for thirty days. Forget one you do not recognise." />
            {status.data.trustedDevices.length === 0 ? (
              <p className="text-muted-foreground text-xs">None. Tick &ldquo;Remember this browser&rdquo; at the code step to add one.</p>
            ) : (
              <ul className="flex flex-col divide-y border">
                {status.data.trustedDevices.map((device) => (
                  <li key={device.id}>
                    <TrustedDeviceRow device={device} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      <Sheet open={enrolOpen} onOpenChange={setEnrolOpen}>
        <SheetContent side={isMobile ? 'bottom' : 'right'} className="gap-0 sm:max-w-lg max-md:max-h-[92vh]">
          <SheetHeader className="border-b">
            <SheetTitle>Set up two-step sign-in</SheetTitle>
            <SheetDescription>Scan, enter the first code, save the recovery codes.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {enrolOpen ? (
              <MfaEnrolment
                onDone={() => {
                  setEnrolOpen(false);
                  toast.add({ type: 'success', title: 'Two-step sign-in is on', description: 'Your next sign-in asks for a code.' });
                }}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <CodeSheet
        open={codesOpen}
        onOpenChange={setCodesOpen}
        title="New recovery codes"
        description="Enter a current code first. The old recovery codes stop working."
        kind="codes"
      />
      <CodeSheet
        open={disableOpen}
        onOpenChange={setDisableOpen}
        title="Turn off two-step sign-in"
        description="Enter a current code or a recovery code. Remembered browsers are forgotten."
        kind="disable"
      />
    </section>
  );
}

function TrustedDeviceRow({ device }: { device: { id: string; userAgent: string | null; createdAt: string; expiresAt: string; current: boolean } }) {
  const revoke = useRevokeTrustedDevice();
  return (
    <Item size="sm" className="min-h-11 rounded-none">
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="truncate">
          {describeAgent(device.userAgent)}
          {device.current ? <Badge variant="outline" className="ml-2">This browser</Badge> : null}
        </ItemTitle>
        <ItemDescription className="tabular-nums">
          Remembered {formatDate(device.createdAt.slice(0, 10))} · until {formatDate(device.expiresAt.slice(0, 10))}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Forget this browser"
          disabled={revoke.isPending}
          onClick={() => {
            revoke.mutate(device.id, {
              onError: (error) => {
                toast.add({ type: 'error', title: 'Could not forget it', description: error instanceof ApiError ? error.message : 'Try again.' });
              },
            });
          }}
        >
          {revoke.isPending ? <Spinner /> : <TrashIcon />}
        </Button>
      </ItemActions>
    </Item>
  );
}

/** A user agent string, read for the two words a person recognises. */
function describeAgent(userAgent: string | null): string {
  if (userAgent === null || userAgent.trim() === '') return 'A browser';
  const os = /iPhone|iPad/u.test(userAgent) ? 'iPhone' : /Android/u.test(userAgent) ? 'Android' : /Mac OS X/u.test(userAgent) ? 'Mac' : /Windows/u.test(userAgent) ? 'Windows' : /Linux/u.test(userAgent) ? 'Linux' : null;
  const browser = /Edg\//u.test(userAgent) ? 'Edge' : /Chrome\//u.test(userAgent) ? 'Chrome' : /Safari\//u.test(userAgent) ? 'Safari' : /Firefox\//u.test(userAgent) ? 'Firefox' : null;
  return [browser, os].filter((part): part is string => part !== null).join(' on ') || 'A browser';
}

/** The two actions that need a code before they do anything. */
function CodeSheet({ open, onOpenChange, title, description, kind }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; kind: 'codes' | 'disable' }) {
  const isMobile = useIsMobile();
  const regenerate = useRegenerateRecoveryCodes();
  const disable = useDisableMfa();
  const [code, setCode] = useState('');
  const [saved, setSaved] = useState(false);
  const pending = regenerate.isPending || disable.isPending;
  const error = kind === 'codes' ? regenerate.error : disable.error;
  const problem = error instanceof ApiError ? error.message : error ? 'Something went wrong. Try again.' : null;

  function close(next: boolean) {
    if (!next) {
      setCode('');
      setSaved(false);
      regenerate.reset();
      disable.reset();
    }
    onOpenChange(next);
  }

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side={isMobile ? 'bottom' : 'right'} className="gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {kind === 'codes' && regenerate.isSuccess ? (
            <RecoveryCodes
              codes={regenerate.data.codes}
              saved={saved}
              onSavedChange={setSaved}
              onDone={() => {
                close(false);
              }}
              lead="These replace the old ones, which no longer work. Shown now and never again."
            />
          ) : (
            <Form
              onSubmit={(event) => {
                event.preventDefault();
                if (pending || code.trim().length === 0) return;
                if (kind === 'codes') regenerate.mutate({ code: code.trim() });
                else
                  disable.mutate(
                    { code: code.trim() },
                    {
                      onSuccess: () => {
                        close(false);
                        toast.add({ type: 'success', title: 'Two-step sign-in is off' });
                      },
                    },
                  );
              }}
            >
              <FieldGroup>
                <Field data-invalid={problem ? true : undefined}>
                  <FieldLabel htmlFor={`mfa-${kind}-code`}>Code</FieldLabel>
                  <Input
                    id={`mfa-${kind}-code`}
                    autoFocus
                    autoComplete="one-time-code"
                    autoCapitalize="characters"
                    spellCheck={false}
                    maxLength={11}
                    placeholder="123456 or ABCDE-FGHJK"
                    className="font-mono tracking-[0.2em]"
                    value={code}
                    aria-invalid={problem ? true : undefined}
                    onChange={(event) => {
                      setCode(event.target.value.toUpperCase());
                    }}
                  />
                  <FieldDescription>{problem ?? 'From the app, or one of your recovery codes.'}</FieldDescription>
                </Field>
                <Button type="submit" variant={kind === 'disable' ? 'destructive' : 'default'} className="w-full sm:w-auto sm:self-start">
                  <SubmitLabel state={pending ? 'pending' : 'idle'}>
                    {pending ? <Spinner data-icon="inline-start" /> : kind === 'codes' ? <KeyIcon data-icon="inline-start" /> : <DevicesIcon data-icon="inline-start" />}
                    {pending ? 'Checking' : kind === 'codes' ? 'Show new codes' : 'Turn off'}
                  </SubmitLabel>
                </Button>
              </FieldGroup>
            </Form>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
