import { useState } from 'react';
import {
  EyeIcon,
  EyeSlashIcon,
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
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { SignInTourOffer } from '@/features/guide';
import { ApiError } from '@/lib/api/client';
import { useLogin } from '@/lib/session/use-session';

import { AuthShell, SubmitLabel } from './auth-shell';

/**
 * REQ-B-01: sign in with a work email and password.
 *
 * There is no "create an account" link, and that is not an omission. Accounts
 * exist only by invitation (REQ-B-03, ADR 0002), so offering a route to one
 * here would advertise a door that is not there.
 */

const schema = z.object({
  email: z.string().min(1, 'Enter your work email.').email('That does not look like an email.'),
  password: z.string().min(1, 'Enter your password.'),
});

type FormValues = z.infer<typeof schema>;

/**
 * What the user is told when sign-in fails.
 *
 * Wrong password and unknown account both say the same thing on purpose: a
 * message that distinguishes them turns the login form into a tool for
 * discovering who works here. The server is careful about this too - it
 * compares a hash even when there is no such user, so the timing does not
 * give the answer away either.
 */
function messageFor(error: unknown): { title: string; description: string } {
  if (!(error instanceof ApiError)) {
    return { title: 'Could not sign in', description: 'Something went wrong. Try again.' };
  }
  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      return {
        title: 'That email and password do not match',
        description: 'Check both and try again.',
      };
    case 'ACCOUNT_LOCKED':
      return {
        title: 'This account is locked',
        description:
          'Too many failed attempts. It unlocks automatically after fifteen minutes, and an email has been sent.',
      };
    case 'ACCOUNT_INACTIVE':
      return {
        title: 'This account is not active',
        description: 'Ask an administrator to reactivate it.',
      };
    case 'RATE_LIMITED':
      return {
        title: 'Too many attempts from this network',
        description: 'Wait a few minutes before trying again.',
      };
    case 'NETWORK_ERROR':
      return {
        title: 'Could not reach the server',
        description: 'Check that the API is running, then try again.',
      };
    default:
      return { title: 'Could not sign in', description: error.message };
  }
}

export function LoginPage() {
  const login = useLogin();
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [revealed, setRevealed] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: FormValues) {
    setSubmitError(null);
    try {
      await login.mutateAsync(values);
    } catch (error: unknown) {
      setSubmitError(error);
    }
  }

  const problem = submitError ? messageFor(submitError) : null;

  return (
    <AuthShell title="Welcome back" lead="Sign in with your work email.">
        {problem ? (
          // aria-live so a screen reader hears the failure; without it the only
          // signal is a visual change the user may not be looking at.
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
            <Field data-invalid={form.formState.errors.email ? true : undefined}>
              <FieldLabel htmlFor="email">Work email</FieldLabel>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={form.formState.errors.email ? true : undefined}
                {...form.register('email')}
              />
              {form.formState.errors.email ? (
                <FieldDescription>{form.formState.errors.email.message}</FieldDescription>
              ) : null}
            </Field>

            <Field data-invalid={form.formState.errors.password ? true : undefined}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              {/* Reveal, because a typo in a masked field is invisible and the
                  cost of getting it wrong is a lockout after five attempts
. The button is a real control, not an icon glued
                  onto the input, so it is reachable by keyboard and announces
                  which state it will switch to. */}
              <InputGroup>
                <InputGroupInput
                  id="password"
                  type={revealed ? 'text' : 'password'}
                  autoComplete="current-password"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={form.formState.errors.password ? true : undefined}
                  {...form.register('password')}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    type="button"
                    aria-label={revealed ? 'Hide password' : 'Show password'}
                    aria-pressed={revealed}
                    onClick={() => {
                      setRevealed((v) => !v);
                    }}
                  >
                    {revealed ? <EyeSlashIcon /> : <EyeIcon />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              {form.formState.errors.password ? (
                <FieldDescription>{form.formState.errors.password.message}</FieldDescription>
              ) : null}
            </Field>

            {/* Stays enabled while submitting, per the interface guidelines: a
                disabled submit button is indistinguishable from a broken one. */}
            <Button type="submit" className="w-full">
              <SubmitLabel state={login.isPending ? 'pending' : 'idle'}>
                {login.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <SignInIcon data-icon="inline-start" />
                )}
                {login.isPending ? 'Signing in' : 'Sign in'}
              </SubmitLabel>
            </Button>
          </FieldGroup>
        </Form>

        <p className="text-muted-foreground text-center text-xs">
          Accounts are created by invitation. Ask an administrator if you do not have one.
        </p>

        <SignInTourOffer />
    </AuthShell>
  );
}
