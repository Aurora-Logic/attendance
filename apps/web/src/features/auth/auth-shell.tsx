import type { ReactNode } from 'react';
import { Link } from 'react-router';

/**
 * The frame the two screens before sign-in share: the wordmark, the page's
 * own title and lead, and the form. One component, so the invitation link
 * lands on a page that is unmistakably the same product as the sign-in it
 * leads to.
 *
 * The column arrives once, on first paint: a 300ms rise through
 * @starting-style. This is the one surface a person sees once a day rather
 * than a hundred times, which is where motion may be more than feedback.
 * Reduced motion collapses it with everything else (index.css).
 */
export function AuthShell({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="ease-out-strong flex w-full max-w-sm flex-col gap-6 transition-[opacity,translate] duration-300 starting:translate-y-2 starting:opacity-0">
        <div className="flex flex-col gap-4">
          {/* A typographic wordmark: display size, negative tracking, so the
              letters sit as a word rather than as a line of text. */}
          <p className="text-2xl font-semibold tracking-[-0.02em]">Vyuha</p>
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            <p className="text-muted-foreground text-sm">{lead}</p>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

/**
 * Signing in, or setting the password that makes an account usable, is how
 * the terms are accepted; this says so where the acceptance happens and
 * links the documents, which are readable without a session.
 */
export function LegalConsent({ verb }: { verb: string }) {
  return (
    <p className="text-muted-foreground text-center text-xs">
      By {verb} you agree to the{' '}
      <Link to="/legal/terms" className="text-foreground underline underline-offset-4">
        Terms and Conditions
      </Link>{' '}
      and the{' '}
      <Link to="/legal/privacy" className="text-foreground underline underline-offset-4">
        Privacy Policy
      </Link>
      .
    </p>
  );
}

/**
 * A submit button's label while its state changes. Keyed on the state, so
 * the new label mounts and arrives through a 2px blur: a crossfade between
 * "Sign in" and "Signing in" otherwise shows two words on top of each other
 * for a frame, and the blur blends them into one.
 */
export function SubmitLabel({ state, children }: { state: string; children: ReactNode }) {
  return (
    <span key={state} className="inline-flex items-center gap-1.5 transition-[filter,opacity] duration-200 starting:opacity-0 starting:blur-[2px]">
      {children}
    </span>
  );
}
