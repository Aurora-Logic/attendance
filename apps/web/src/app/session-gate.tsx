import { useEffect, type ReactNode } from 'react';

import { Spinner } from '@/components/ui/spinner';
import { LoginPage } from '@/features/auth/login-page';
import { useSessionStore } from '@/lib/session/session-store';
import { useMe } from '@/lib/session/use-session';

/**
 * Decides whether the visitor sees the application or the sign-in screen.
 *
 * Three states, not two. "Still resolving" is distinct from "anonymous"
 * because the access token lives in memory only and a cold load has to try
 * the refresh cookie first — collapsing the two would flash the login screen
 * at every signed-in user on every page refresh.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const { data: me, isPending } = useMe();
  const setFromMe = useSessionStore((s) => s.setFromMe);
  const clear = useSessionStore((s) => s.clear);

  useEffect(() => {
    if (isPending) return;
    if (me) {
      const name = me.employee
        ? [me.employee.firstName, me.employee.lastName].filter(Boolean).join(' ')
        : me.user.email;
      setFromMe({
        displayName: name,
        roleLabel: me.roles.map((r) => r.name).join(', ') || 'No role',
        employeeId: me.user.employeeId,
        permissions: [...me.permissions],
      });
    } else {
      clear();
    }
  }, [me, isPending, setFromMe, clear]);

  if (isPending) {
    return (
      <div
        className="flex min-h-dvh items-center justify-center"
        role="status"
        aria-label="Loading"
      >
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!me) return <LoginPage />;

  return <>{children}</>;
}
