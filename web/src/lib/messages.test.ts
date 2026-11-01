import { describe, expect, it } from "vitest";
import type { ApiFailure } from "./api";
import { ERROR_MESSAGES, errorMessage, OFFLINE_MESSAGE, rateLimitMessage, USERNAME_MESSAGES } from "./messages";

describe("messages", () => {
  it("has a non-empty German text for every error code", () => {
    for (const [code, text] of Object.entries(ERROR_MESSAGES)) {
      expect(text.trim(), code).not.toBe("");
      expect(text, code).not.toContain(code);
    }
  });

  it("has a text for every username problem", () => {
    expect(Object.keys(USERNAME_MESSAGES).sort()).toEqual(["invalid_characters", "too_long", "too_short"]);
    for (const text of Object.values(USERNAME_MESSAGES)) expect(text.trim()).not.toBe("");
  });

  it("explains an unreachable server", () => {
    expect(errorMessage({ ok: false, kind: "offline" })).toBe(OFFLINE_MESSAGE);
    expect(OFFLINE_MESSAGE).toContain("nicht erreichbar");
  });
});

describe("rateLimitMessage", () => {
  it.each([
    [1, "Zu viele Versuche. Bitte warte 1 Minute."],
    [60, "Zu viele Versuche. Bitte warte 1 Minute."],
    [61, "Zu viele Versuche. Bitte warte 2 Minuten."],
    [150, "Zu viele Versuche. Bitte warte 3 Minuten."],
    [180, "Zu viele Versuche. Bitte warte 3 Minuten."],
  ])("rounds %i seconds up to whole minutes", (seconds, text) => {
    expect(rateLimitMessage(seconds)).toBe(text);
  });

  it("falls back to a general text without a time", () => {
    expect(rateLimitMessage(undefined)).toBe(ERROR_MESSAGES.rate_limited);
  });
});

describe("errorMessage", () => {
  const failure = (extra: Partial<Extract<ApiFailure, { kind: "error" }>>): ApiFailure => ({
    ok: false,
    kind: "error",
    status: 400,
    code: "error",
    ...extra,
  });

  it("shows the waiting time for a rate limit", () => {
    expect(errorMessage(failure({ status: 429, code: "rate_limited", retryAfterSeconds: 170 }))).toBe(
      "Zu viele Versuche. Bitte warte 3 Minuten.",
    );
  });

  it("names the field of a validation error in plain words", () => {
    expect(errorMessage(failure({ code: "validation", field: "username" }))).toBe("Bitte prüfe das Feld „Benutzername“.");
    expect(errorMessage(failure({ code: "validation", field: "newPassword" }))).toContain("Neues Passwort");
  });

  it("does not show a technical field name it does not know", () => {
    expect(errorMessage(failure({ code: "validation", field: "xyz_internal" }))).toBe(ERROR_MESSAGES.validation);
  });

  it("uses the text of the code otherwise", () => {
    expect(errorMessage(failure({ code: "invalid_credentials" }))).toBe(ERROR_MESSAGES.invalid_credentials);
  });
});
