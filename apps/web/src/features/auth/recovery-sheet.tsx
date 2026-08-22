import { FilePdfIcon } from '@phosphor-icons/react';

import { Button } from '@/components/ui/button';
import { useBranding } from '@/lib/branding/use-branding';
import { formatDate } from '@/lib/format';
import { useMe } from '@/lib/session/use-session';

/**
 * The recovery codes as a sheet to keep: who they belong to, where, when
 * they were issued, the ten codes, how one is used, and what to do when
 * they are gone too. Printed from the screen that holds them (index.css,
 * data-print="recovery"), because the codes exist in the clear only there.
 */
export function RecoveryCodesPdf({ codes }: { codes: readonly string[] }) {
  const me = useMe();
  const branding = useBranding();
  const email = me.data?.user.email ?? '—';
  const orgName = branding.data?.name ?? 'Vyuha';
  const issuedOn = new Date().toISOString().slice(0, 10);

  function download() {
    const previousTitle = document.title;
    document.body.dataset.print = 'recovery';
    document.title = `Vyuha recovery codes - ${email}`;
    const restore = () => {
      delete document.body.dataset.print;
      document.title = previousTitle;
    };
    window.addEventListener('afterprint', restore, { once: true });
    window.print();
  }

  return (
    <>
      <Button variant="outline" onClick={download}>
        <FilePdfIcon data-icon="inline-start" />
        Download as PDF
      </Button>
      <div className="recovery-sheet" aria-hidden>
        <div className="flex flex-col gap-6 text-sm">
          <div className="flex items-baseline justify-between gap-4 border-b border-neutral-800 pb-3">
            <span className="text-2xl font-semibold tracking-[-0.02em]">Vyuha</span>
            <span className="text-xs">Two-step sign-in recovery codes</span>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
            <dt className="text-neutral-600">Account</dt>
            <dd className="font-medium">{email}</dd>
            <dt className="text-neutral-600">Organisation</dt>
            <dd className="font-medium">{orgName}</dd>
            <dt className="text-neutral-600">Issued on</dt>
            <dd className="font-medium tabular-nums">{formatDate(issuedOn)}</dd>
          </dl>
          <ol className="grid grid-cols-2 gap-x-10 gap-y-2 border border-neutral-800 p-4 font-mono text-base tabular-nums">
            {codes.map((code, index) => (
              <li key={code} className="flex gap-3">
                <span className="text-neutral-500">{String(index + 1).padStart(2, '0')}</span>
                <span>{code}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-2">
            <p className="font-semibold">How to use one</p>
            <p>Sign in with your password. At the code step choose &ldquo;Use a recovery code&rdquo; and type one of the codes above. Each code works once; strike it out after use.</p>
            <p className="font-semibold">If you lose your phone</p>
            <p>A recovery code signs you in. Then open Profile, Two-step sign-in, and set up the authenticator app again on the new phone; a fresh set of codes is issued and these stop working.</p>
            <p className="font-semibold">If these are lost as well</p>
            <p>An administrator can reset two-step sign-in from your employee page. You sign in with your password alone afterwards and, if your role requires it, set the app up again.</p>
            <p className="text-neutral-600">Keep this sheet where the phone is not. Anyone holding a code and your password can sign in as you.</p>
          </div>
        </div>
      </div>
    </>
  );
}
