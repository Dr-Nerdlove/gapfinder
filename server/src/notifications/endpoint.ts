// The subscription address of a push message comes from the client, so the server must never send to just
// any address: only to the known push services of the browsers (https, port 443, fixed host list). Everything
// else would let a logged-in person make the server call arbitrary addresses (the firewall would stop most,
// but not all, of it).

const EXACT_HOSTS = new Set(["fcm.googleapis.com", "web.push.apple.com", "updates.push.services.mozilla.com"]);
const HOST_SUFFIXES = [".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"];
const MAX_ENDPOINT_LENGTH = 2048;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** True when `raw` is an address of one of the known push services. */
export function isAllowedPushEndpoint(raw: string): boolean {
  if (raw.length === 0 || raw.length > MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.port !== "" && url.port !== "443") return false;
  if (url.username !== "" || url.password !== "") return false;
  const host = url.hostname.toLowerCase();
  return EXACT_HOSTS.has(host) || HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** True when the subscription keys look like what browsers send (base64url; p256dh is 65 bytes, auth 16). */
export function areValidPushKeys(p256dh: string, auth: string): boolean {
  return (
    BASE64URL.test(p256dh) && p256dh.length >= 40 && p256dh.length <= 200 && BASE64URL.test(auth) && auth.length >= 8 && auth.length <= 64
  );
}
