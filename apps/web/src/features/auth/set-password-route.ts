/**
 * Which of the two token screens a path is, if either.
 *
 * Matched here rather than in `App.tsx`'s route table because both screens sit
 * *outside* the session: those routes render inside `AppShell`, which only
 * exists once somebody is signed in, and an invited person by definition is
 * not. `SessionGate` is the component that already decides "application or
 * sign-in form", and this is the third answer.
 *
 * Its own module so the page file exports nothing but a component, which is
 * what keeps fast refresh working on it.
 */

export type SetPasswordMode = 'invitation' | 'reset';

export interface SetPasswordTarget {
  readonly mode: SetPasswordMode;
  /** Empty when the path carried nothing that could be a token. */
  readonly token: string;
}

/**
 * The token is checked for shape, not merely for presence: the server issues
 * base64url, and a segment carrying anything else is a mangled paste that
 * deserves the "this link is incomplete" screen rather than a request.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;

const PREFIXES: readonly { prefix: string; mode: SetPasswordMode }[] = [
  { prefix: '/accept-invitation/', mode: 'invitation' },
  { prefix: '/reset-password/', mode: 'reset' },
];

export function setPasswordRoute(pathname: string): SetPasswordTarget | null {
  for (const { prefix, mode } of PREFIXES) {
    if (!pathname.startsWith(prefix)) continue;
    // A trailing slash and nothing else: a link pasted with one should still
    // work, and nothing after the token is part of it.
    const token = pathname.slice(prefix.length).replace(/\/+$/u, '');
    return { mode, token: TOKEN_PATTERN.test(token) ? token : '' };
  }
  return null;
}
