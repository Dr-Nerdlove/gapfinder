import type { ErrorCode, UsernameProblem } from "@lueckenfueller/shared";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from "@lueckenfueller/shared";
import type { ApiFailure } from "./api";

export const OFFLINE_MESSAGE =
  "Der Server ist gerade nicht erreichbar. Er ist nachts von 1 bis 7 Uhr aus. Versuch es später noch einmal.";

/** German text for every error code (a Record, so TypeScript forces a text for each new code). */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  validation: "Bitte prüfe deine Eingaben.",
  unauthorized: "Du bist nicht angemeldet. Bitte melde dich an.",
  forbidden: "Das darfst du nicht.",
  not_found: "Das gibt es nicht (mehr).",
  invalid_credentials: "Benutzername oder Passwort stimmt nicht.",
  rate_limited: "Zu viele Versuche. Bitte warte einen Moment.",
  username_taken: "Diesen Benutzernamen gibt es schon. Bitte wähle einen anderen.",
  invite_invalid: "Diese Einladung gilt nicht mehr. Bitte den Admin um eine neue.",
  reset_invalid: "Dieser Link zum Zurücksetzen gilt nicht mehr. Bitte den Admin um einen neuen.",
  wrong_password: "Das aktuelle Passwort stimmt nicht.",
  cannot_delete_self: "Du kannst dein eigenes Konto nicht löschen.",
  error: "Das hat nicht geklappt. Bitte versuche es noch einmal.",
};

export const USERNAME_MESSAGES: Record<UsernameProblem, string> = {
  too_short: `Der Benutzername muss mindestens ${USERNAME_MIN_LENGTH} Zeichen lang sein.`,
  too_long: `Der Benutzername darf höchstens ${USERNAME_MAX_LENGTH} Zeichen lang sein.`,
  invalid_characters:
    "Der Benutzername darf nur Buchstaben, Ziffern, Leerzeichen und die Zeichen . ' _ - enthalten.",
};

export const PASSWORD_TOO_SHORT_MESSAGE = `Das Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen lang sein.`;
export const PASSWORD_TOO_LONG_MESSAGE = `Das Passwort darf höchstens ${PASSWORD_MAX_LENGTH} Zeichen lang sein.`;
export const PASSWORD_MISMATCH_MESSAGE = "Die beiden Passwörter sind nicht gleich.";

/** The fields a `validation` error can name, in plain words. */
const FIELD_NAMES: Record<string, string> = {
  username: "Benutzername",
  password: "Passwort",
  currentPassword: "Aktuelles Passwort",
  newPassword: "Neues Passwort",
  name: "Name",
  seedColor: "Farbe",
};

/** "Zu viele Versuche. Bitte warte 3 Minuten." Rounds up, at least one minute. */
export function rateLimitMessage(retryAfterSeconds?: number): string {
  if (retryAfterSeconds === undefined || !Number.isFinite(retryAfterSeconds)) return ERROR_MESSAGES.rate_limited;
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Zu viele Versuche. Bitte warte ${minutes === 1 ? "1 Minute" : `${minutes} Minuten`}.`;
}

/** The text to show for a failed request. */
export function errorMessage(failure: ApiFailure): string {
  if (failure.kind === "offline") return OFFLINE_MESSAGE;
  if (failure.code === "rate_limited") return rateLimitMessage(failure.retryAfterSeconds);
  if (failure.code === "validation" && failure.field !== undefined) {
    const name = FIELD_NAMES[failure.field];
    if (name !== undefined) return `Bitte prüfe das Feld „${name}“.`;
  }
  return ERROR_MESSAGES[failure.code];
}
