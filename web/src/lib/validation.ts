import {
  normalizeName,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  usernameProblem,
} from "@lueckenfueller/shared";
import {
  PASSWORD_MISMATCH_MESSAGE,
  PASSWORD_TOO_LONG_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  USERNAME_MESSAGES,
} from "./messages";

/** German message when the typed username breaks the rules, else null. */
export function checkUsername(raw: string): string | null {
  const problem = usernameProblem(normalizeName(raw));
  return problem === null ? null : USERNAME_MESSAGES[problem];
}

/** German message when a new password is unusable or the repetition differs, else null. */
export function checkNewPassword(password: string, repeat: string): string | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return PASSWORD_TOO_SHORT_MESSAGE;
  if (length > PASSWORD_MAX_LENGTH) return PASSWORD_TOO_LONG_MESSAGE;
  if (password !== repeat) return PASSWORD_MISMATCH_MESSAGE;
  return null;
}
