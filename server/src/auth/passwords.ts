import { hash, verify } from "@node-rs/argon2";

/** Argon2id with the library's defaults. */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifies a password against a stored hash. For `null` (unknown user) it verifies against a dummy hash made
 * with the same settings, so the answer takes equally long and does not reveal which usernames exist.
 */
export async function verifyPassword(storedHash: string | null, password: string): Promise<boolean> {
  if (storedHash === null) {
    dummyHash ??= hash("dummy password for equal timing");
    await verify(await dummyHash, password);
    return false;
  }
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}
