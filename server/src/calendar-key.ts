// The key that encrypts calendar subscription links (they carry a secret in the address) before they are
// stored. The key comes from the environment (`CALENDAR_KEY`), never from the database; the database only
// keeps a check value so a wrong key is noticed instead of silently making stored links unreadable.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/** Row in `meta`: check value of the key that the stored calendar links were encrypted with. */
export const META_KEY_CHECK = "calendar_key_check";
/** Row in `meta` that exists only inside a backup file: the key itself (base64), so a restore can put it back. */
export const META_BACKUP_KEY = "backup_calendar_key";

const FORMAT_PREFIX = "v1.";
const AAD = Buffer.from("lueckenfueller:calendar-link:v1");
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_CHECK_LABEL = "lueckenfueller calendar key check v1";

/** The key from its text form: standard base64 in canonical form of exactly 32 bytes, otherwise null. */
export function decodeCalendarKey(text: string): Buffer | null {
  const bytes = Buffer.from(text, "base64");
  return bytes.length === 32 && bytes.toString("base64") === text ? bytes : null;
}

/** AES-256-GCM. Result: `v1.` + base64url(nonce || ciphertext || tag). */
export function encryptSecret(key: Buffer, plaintext: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return FORMAT_PREFIX + Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString("base64url");
}

/** Reverse of `encryptSecret`. Throws for an unknown format, a too short value, tampering or a wrong key. */
export function decryptSecret(key: Buffer, stored: string): string {
  if (!stored.startsWith(FORMAT_PREFIX)) {
    throw new Error("Unknown format of the encrypted value");
  }
  const raw = Buffer.from(stored.slice(FORMAT_PREFIX.length), "base64url");
  if (raw.length < NONCE_BYTES + TAG_BYTES) {
    throw new Error("The encrypted value is too short");
  }
  const nonce = raw.subarray(0, NONCE_BYTES);
  const tag = raw.subarray(raw.length - TAG_BYTES);
  const ciphertext = raw.subarray(NONCE_BYTES, raw.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("The encrypted value cannot be decrypted (wrong key or damaged)");
  }
}

/** A value derived from the key that identifies it without revealing it (hex). */
export function keyCheckValue(key: Buffer): string {
  return createHmac("sha256", key).update(KEY_CHECK_LABEL).digest("hex");
}

/** True when two check values (hex strings) are equal; compared in constant time. */
export function checkValuesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export type CalendarKeyStatus = "not-configured" | "ok" | "wrong";

/**
 * Called when the server starts. Remembers the key's check value on first use and compares it afterwards.
 * Also removes a stray copy of the key from the live database (a restore that did not take it out).
 */
export function prepareCalendarKey(db: DatabaseSync, key: Buffer | null): CalendarKeyStatus {
  removeStrayBackupKey(db);
  if (key === null) return "not-configured";
  const check = keyCheckValue(key);
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)").run(META_KEY_CHECK, check);
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(META_KEY_CHECK) as { value: string } | undefined;
  return row !== undefined && checkValuesEqual(row.value, check) ? "ok" : "wrong";
}

function removeStrayBackupKey(db: DatabaseSync): void {
  const stray = db.prepare("SELECT 1 FROM meta WHERE key = ?").get(META_BACKUP_KEY);
  if (stray === undefined) return;
  // Overwrite the freed space, so the key does not stay readable inside the file.
  db.exec("PRAGMA secure_delete = ON");
  db.prepare("DELETE FROM meta WHERE key = ?").run(META_BACKUP_KEY);
}
