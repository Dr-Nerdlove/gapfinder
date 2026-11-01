import { createHash, randomBytes } from "node:crypto";

/** A new random secret for a session, invite or password reset (256 bits, URL safe). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this hash is stored; a stolen database does not reveal usable tokens. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
