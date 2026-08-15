/**
 * Where a single-use token sends somebody (REQ-B-03, REQ-B-04).
 *
 * A function rather than two template literals inside `AuthService`, and it is
 * exported so it can be tested against a base URL the running process does not
 * have. `WEB_BASE_URL` is validated for its protocol and nothing else, so
 * `https://vyuha.example/` is a legal setting -- and the obvious
 * `${base}/accept-invitation/${token}` turns it into
 * `https://vyuha.example//accept-invitation/<token>`, whose pathname starts
 * with two slashes and matches no route the web app declares.
 *
 * That was survivable while the link went out by email and a person retyped it.
 * It is not survivable now: the link *is* the delivery mechanism, and a
 * deployment that happened to set a trailing slash would hand every new
 * employee a URL that 404s.
 */

export const INVITATION_PATH = '/accept-invitation';
export const PASSWORD_RESET_PATH = '/reset-password';

export function tokenLink(webBaseUrl: string, path: string, token: string): string {
  return `${webBaseUrl.replace(/\/+$/u, '')}${path}/${token}`;
}
