import type { DatabaseSync } from "node:sqlite";
import webpush from "web-push";

const PUBLIC_KEY = "vapid_public_key";
const PRIVATE_KEY = "vapid_private_key";
const FALLBACK_SUBJECT = "https://github.com/Dr-Nerdlove/gapfinder";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/**
 * The server's own key pair for Web Push. Made once on first start and kept in `meta`, so nothing has to be set
 * up in the VM and a restored backup keeps its subscriptions working. `INSERT OR IGNORE`: a second start (or a
 * second process) keeps the keys that are already there.
 */
export function loadVapidKeys(db: DatabaseSync): VapidKeys {
  const read = (): VapidKeys | null => {
    const rows = db.prepare("SELECT key, value FROM meta WHERE key IN (?, ?)").all(PUBLIC_KEY, PRIVATE_KEY) as {
      key: string;
      value: string;
    }[];
    const publicKey = rows.find((row) => row.key === PUBLIC_KEY)?.value;
    const privateKey = rows.find((row) => row.key === PRIVATE_KEY)?.value;
    return publicKey !== undefined && privateKey !== undefined ? { publicKey, privateKey } : null;
  };
  const existing = read();
  if (existing) return existing;
  const fresh = webpush.generateVAPIDKeys();
  const insert = db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)");
  insert.run(PUBLIC_KEY, fresh.publicKey);
  insert.run(PRIVATE_KEY, fresh.privateKey);
  return read()!;
}

/** The contact address the push services get with every message: the first https origin of the app, else the repository. */
export function vapidSubject(corsOrigins: readonly string[]): string {
  return corsOrigins.find((origin) => origin.startsWith("https://")) ?? FALLBACK_SUBJECT;
}
