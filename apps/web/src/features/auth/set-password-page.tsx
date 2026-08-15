import { useState } from 'react';
import {
  CheckCircleIcon,
  EyeIcon,
  EyeSlashIcon,
  KeyIcon,
  SignInIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Form } from '@/components/shared/form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { ApiError, apiRequest } from '@/lib/api/client';
import { MIN_PASSWORD_LENGTH } from '@vyuha/shared';

import type { SetPasswordMode, SetPasswordTarget } from './set-password-route';

/**
 * Where an invitation link and a password-reset link land (REQ-B-03, REQ-B-04).
 *
 * Both endpoints have existed since Phase 0 and **nothing in the web app ever
 * reached them**: the server minted `/accept-invitation/<token>` and
 * `/reset-password/<token>`, and every one of those URLs fell through
 * `SessionGate` to the sign-in form, which is not a page anybody can set a
 * password on. Sending the link by email hid the gap -- with no mail server
 * nobody had ever followed one. Handing the link to an administrator to pass on
 * makes it the first thing they would hit.
 *
 * One screen for both, because they are the same act: prove you hold a
 * single-use token, choose a password. The differences are the endpoint, the
 * word for the deadline, and what has already happened to the account.
 *
 * The token is the credential, so this renders whatever the session says --
 * signed in, signed out, or still resolving. It never puts the token in a
 * request body or a query string; it is a path segment, exactly as issued.
 */

type SetPasswordPageProps = SetPasswordTarget;

const COPY: Record<SetPasswordMode, {
  heading: string;
  lead: string;
  path: (token: string) => string;
  submit: string;
  submitting: string;
  doneTitle: string;
  doneBody: string;
}> = {
  invitation: {
    heading: 'Set your password',
    lead: 'You have been invited to Vyuha. Choose a password and the account is yours.',
    path: (token) => `/auth/invitations/${token}/accept`,
    submit: 'Set password and finish',
    submitting: 'Setting password',
    doneTitle: 'Your account is ready',
    doneBody: 'Sign in with your work email and the password you just chose.',
  },
  reset: {
    heading: 'Choose a new password',
    lead: 'This link lets you set a new password once. Everywhere you are currently signed in will be signed out.',
    path: (token) => `/auth/password-resets/${token}/confirm`,
    submit: 'Change password',
    submitting: 'Changing password',
    doneTitle: 'Your password has been changed',
    doneBody: 'Every other session was ended. Sign in again with the new password.',
  },
};

/**
 * Length only, and deliberately.
 *
 * REQ-B-01 also refuses a common password and one containing the account's own
 * address, and both of those are checked on the server -- which knows the
 * address and holds the list. The client refuses the one rule it can apply
 * honestly, and renders the server's own sentence for the rest, so the two can
 * never disagree about why something was rejected.
 */
const schema = z
  .object({
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Use at least ${String(MIN_PASSWORD_LENGTH)} characters.`),
    confirm: z.string().min(1, 'Type the password again.'),
  })
  .refine((values) => values.password === values.confirm, {
    path: ['confirm'],
    message: 'The two do not match.',
  });

type FormValues = z.infer<typeof schema>;

/**
 * What the reader is told when the link will not work.
 *
 * Every one of these is a real state a person reaches by being handed a link a
 * day late, or twice, and each needs a different next step. "Something went
 * wrong" would send all of them to the same dead end.
 */
function messageFor(error: unknown, mode: SetPasswordMode): { title: string; description: string } {
  const thing = mode === 'invitation' ? 'invitation' : 'reset link';

  if (!(error instanceof ApiError)) {
    return { title: 'That did not work', description: 'Something went wrong. Try again.' };
  }

  switch (error.code) {
    case 'PASSWORD_TOO_WEAK':
      // The server names the rule it applied; repeating it is more use than
      // replacing it with a generic line.
      return { title: 'Choose a different password', description: error.message };
    case 'INVITATION_ALREADY_ACCEPTED':
      return {
        title: 'This invitation has already been used',
        description:
          'The account exists and has a password. Sign in, or ask an administrator for a password reset link.',
      };
    case 'INVITATION_EXPIRED':
      return {
        title: 'This invitation has expired',
        description: `An ${thing} lasts 72 hours. Ask whoever sent it for a new one.`,
      };
    case 'TOKEN_EXPIRED':
      return {
        title: 'This link has expired',
        description: 'A reset link lasts 30 minutes. Ask for a new one.',
      };
    case 'TOKEN_INVALID':
      return {
        title: `This ${thing} is not valid`,
        description:
          'It may have been used, withdrawn, or replaced by a newer one. Check you copied the whole link, then ask for another.',
      };
    case 'NETWORK_ERROR':
      return {
        title: 'Could not reach the server',
        description: 'Nothing was changed. Check the connection and try again.',
      };
    case 'RATE_LIMITED':
      return {
        title: 'Too many attempts from this network',
        description: 'Wait a few minutes before trying again.',
      };
    default:
      return { title: 'That did not work', description: error.message };
  }
}

export function SetPasswordPage({ mode, token }: SetPasswordPageProps) {
  const copy = COPY[mode];
  const [failure, setFailure] = useState<unknown>(null);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });

  async function onSubmit(values: FormValues) {
    setFailure(null);
    setSubmitting(true);
    try {
      // `skipRefresh`, like every other public auth call: a 401 here is this
      // endpoint's verdict on the token, not an expired session, and a retry
      // would replay the very request being refused.
      await apiRequest<unknown>(copy.path(token), {
        method: 'POST',
        body: { password: values.password },
        skipRefresh: true,
      });
      setDone(true);
    } catch (error: unknown) {
      setFailure(error);
    } finally {
      setSubmitting(false);
    }
  }

  const problem = failure === null ? null : messageFor(failure, mode);

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span
            aria-hidden
            className="bg-primary text-primary-foreground flex size-10 items-center justify-center text-base font-semibold"
          >
            V
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">
              {done ? copy.doneTitle : copy.heading}
            </h1>
            <p className="text-muted-foreground text-sm">
              {token.length === 0 ? 'This link cannot be read.' : done ? copy.doneBody : copy.lead}
            </p>
          </div>
        </div>

        {/* A path that is not a token at all never becomes a request. The
            server would refuse it, but only after a round trip that says
            nothing useful — and a truncated paste is the likeliest cause. */}
        {token.length === 0 ? (
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle>This link is incomplete</AlertTitle>
            <AlertDescription>
              The address is missing the code that identifies it. Copy the whole link, including
              everything after the last slash, and open it again.
            </AlertDescription>
          </Alert>
        ) : done ? (
          <>
            <Alert>
              <CheckCircleIcon />
              <AlertTitle>{copy.doneTitle}</AlertTitle>
              <AlertDescription>
                The link you used stops working now — it could only be used once.
              </AlertDescription>
            </Alert>
            {/* A full navigation rather than a route change: the session state
                this document holds was decided before any of this happened. */}
            <Button
              className="w-full"
              onClick={() => {
                window.location.assign('/');
              }}
            >
              <SignInIcon data-icon="inline-start" />
              Go to sign in
            </Button>
          </>
        ) : (
          <>
            {problem ? (
              <Alert variant="destructive" aria-live="assertive">
                <WarningCircleIcon />
                <AlertTitle>{problem.title}</AlertTitle>
                <AlertDescription>{problem.description}</AlertDescription>
              </Alert>
            ) : null}

            <Form
              onSubmit={(event) => {
                void form.handleSubmit(onSubmit)(event);
              }}
            >
              <FieldGroup>
                <Field data-invalid={form.formState.errors.password ? true : undefined}>
                  <FieldLabel htmlFor="password">New password</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="password"
                      type={revealed ? 'text' : 'password'}
                      autoComplete="new-password"
                      autoCapitalize="none"
                      spellCheck={false}
                      autoFocus
                      aria-invalid={form.formState.errors.password ? true : undefined}
                      {...form.register('password')}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        type="button"
                        aria-label={revealed ? 'Hide password' : 'Show password'}
                        aria-pressed={revealed}
                        onClick={() => {
                          setRevealed((value) => !value);
                        }}
                      >
                        {revealed ? <EyeSlashIcon /> : <EyeIcon />}
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldDescription>
                    {form.formState.errors.password?.message ??
                      `At least ${String(MIN_PASSWORD_LENGTH)} characters. A few words you will remember beat a short one you will not.`}
                  </FieldDescription>
                </Field>

                <Field data-invalid={form.formState.errors.confirm ? true : undefined}>
                  <FieldLabel htmlFor="confirm">Type it again</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="confirm"
                      type={revealed ? 'text' : 'password'}
                      autoComplete="new-password"
                      autoCapitalize="none"
                      spellCheck={false}
                      aria-invalid={form.formState.errors.confirm ? true : undefined}
                      {...form.register('confirm')}
                    />
                  </InputGroup>
                  {form.formState.errors.confirm ? (
                    <FieldDescription>{form.formState.errors.confirm.message}</FieldDescription>
                  ) : (
                    <FieldDescription>
                      A password nobody can read back is worth checking twice — five wrong
                      sign-ins lock the account for fifteen minutes.
                    </FieldDescription>
                  )}
                </Field>

                {/* Stays enabled while submitting, per the interface
                    guidelines: a disabled submit is indistinguishable from a
                    broken one. */}
                <Button type="submit" className="w-full">
                  {submitting ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <KeyIcon data-icon="inline-start" />
                  )}
                  {submitting ? copy.submitting : copy.submit}
                </Button>
              </FieldGroup>
            </Form>
          </>
        )}
      </div>
    </main>
  );
}

