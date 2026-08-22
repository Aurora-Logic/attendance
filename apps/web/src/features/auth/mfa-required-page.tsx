import { SignOutIcon } from '@phosphor-icons/react';

import { Button } from '@/components/ui/button';
import { useLogout } from '@/lib/session/use-session';

import { AuthShell } from './auth-shell';
import { MfaEnrolment } from './mfa-enrolment';

/**
 * REQ-B-09: a role the policy names signs in and, before any screen, sets
 * up the authenticator. The session exists -- the password was right --
 * but the shell is withheld until the first code is confirmed. The only
 * other way out is to sign out.
 */
export function MfaRequiredPage() {
  const logout = useLogout();
  return (
    <AuthShell title="Set up two-step sign-in" lead="Your role requires an authenticator app. It takes a minute, once.">
      <MfaEnrolment
        onDone={() => {
          // The session query refetches on confirm (use-mfa); the gate then
          // lets the shell through. Nothing to navigate.
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => {
          logout.mutate();
        }}
      >
        <SignOutIcon data-icon="inline-start" />
        Sign out instead
      </Button>
    </AuthShell>
  );
}
