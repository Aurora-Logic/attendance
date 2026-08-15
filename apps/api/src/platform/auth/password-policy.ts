import { MIN_PASSWORD_LENGTH } from '@vyuha/shared';

import { AppError } from '../common/errors.js';

/**
 * REQ-B-01: "minimum 10 characters, checked against a common-password list, no
 * composition rules."
 *
 * No composition rules is the deliberate part. Forcing a digit and a symbol
 * produces "Password1!" -- which is on the list below -- while a four-word
 * passphrase that no list contains gets rejected for having no capital.
 *
 * The floor itself lives in `@vyuha/shared` so the invitation-accept form can
 * refuse ten characters before the round trip rather than after it. Only the
 * number is shared: the list below stays on the server, because shipping a
 * catalogue of weak passwords to the browser helps nobody but the guesser.
 */

export { MIN_PASSWORD_LENGTH };

/**
 * A short list rather than a downloaded corpus of ten million.
 *
 * The 10-character floor already removes almost everything in a leaked-password
 * dump: "123456", "password", "qwerty" and their kind are too short to reach
 * this check. What survives the floor is a much smaller set of long-but-obvious
 * choices, which is what this list is for. A full corpus is a Phase 2 job with
 * a real data file behind it, not a constant in a source tree.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  '1234567890',
  '12345678901',
  '123456789012',
  '1234567890123',
  '11111111111',
  '0987654321',
  'qwertyuiop',
  'qwertyuiop123',
  'asdfghjkl123',
  'password12',
  'password123',
  'password1234',
  'password@123',
  'password!123',
  'passw0rd123',
  'p@ssw0rd123',
  'p@ssword123',
  'welcome123',
  'welcome@123',
  'iloveyou123',
  'letmein123',
  'admin@123',
  'admin12345',
  'administrator',
  'abcd1234567',
  'abc123456789',
  'qwerty123456',
  'zaq12wsxcde3',
  '1qaz2wsx3edc',
  'trustno1234',
  'sunshine123',
  'princess123',
  'football123',
  'baseball123',
  'monkey123456',
  'dragon123456',
  'superman123',
  'batman12345',
  'starwars123',
  'computer123',
  'changeme123',
  'secret12345',
  'temppassword',
  'temp@12345',
  'india@12345',
  'bharat@1234',
  'company@123',
  'newpassword',
  'mypassword1',
  'thisisapassword',
]);

function isSingleRepeatedCharacter(value: string): boolean {
  const first = value[0];
  if (first === undefined) return false;
  return [...value].every((character) => character === first);
}

/**
 * Throws `PASSWORD_TOO_WEAK` with the reason in `details`, so the web client
 * can show the specific rule that failed rather than a generic refusal.
 *
 * `email` is optional and used only to reject a password that is the account's
 * own address or its local part -- the single most common choice a policy that
 * only counts characters lets through.
 */
export function assertPasswordAcceptable(password: string, email?: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError('PASSWORD_TOO_WEAK', `Password must be at least ${String(MIN_PASSWORD_LENGTH)} characters.`, {
      details: { rule: 'minLength', minLength: MIN_PASSWORD_LENGTH },
    });
  }

  const normalised = password.normalize('NFKC').toLowerCase();

  if (COMMON_PASSWORDS.has(normalised)) {
    throw new AppError('PASSWORD_TOO_WEAK', 'That password is too common. Choose something else.', {
      details: { rule: 'commonPassword' },
    });
  }

  if (isSingleRepeatedCharacter(normalised)) {
    throw new AppError('PASSWORD_TOO_WEAK', 'That password is a single repeated character.', {
      details: { rule: 'commonPassword' },
    });
  }

  if (email !== undefined && email.length > 0) {
    const address = email.toLowerCase();
    const localPart = address.split('@')[0] ?? '';
    if (normalised === address || (localPart.length >= 4 && normalised.includes(localPart))) {
      throw new AppError('PASSWORD_TOO_WEAK', 'Password must not contain your email address.', {
        details: { rule: 'containsEmail' },
      });
    }
  }
}
