// Fetches a user's calendar subscription link (ICS) safely. The server is reachable from the whole internet and
// the links come from users, so this must never be talked into reaching the home network, the VM, Docker, the
// Hyper-V host or Tailscale (SSRF). The link carries the user's secret: it is never put into an error message
// or a log, and this module never throws.
import { promises as dnsPromises } from "node:dns";
import type { LookupOptions } from "node:dns";
import type http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { isPublicAddress } from "./addresses.js";

export const MAX_URL_LENGTH = 2048;
export const MAX_CALENDAR_BYTES = 10 * 1024 * 1024;
export const MAX_REDIRECTS = 5;
export const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT = "Lueckenfueller/1.0 (calendar subscription)";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const GONE_STATUSES = new Set([401, 403, 404, 410]);

export type FetchFailure = "invalid_link" | "blocked_address" | "gone" | "unreachable" | "too_large";
export type FetchResult = { ok: true; text: string } | { ok: false; reason: FetchFailure };

/** Production never sets any of these; they exist so tests can use a local server and fake DNS. */
export interface FetchOptions {
  /** Replaces the DNS lookup. */
  lookup?: (hostname: string) => Promise<{ address: string; family: number }[]>;
  /** Replaces the check that decides whether an address may be connected to. */
  isAllowedAddress?: (ip: string) => boolean;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Replaces https on port 443, so a test can talk to a plain local `node:http` server. */
  transport?: { request: typeof http.request; port: number };
}

/**
 * The link as a safe `https:` URL, or null. `webcal://` is the same as `https://`. No passwords in the link, no
 * other port than 443, and an IP address as host only when it is a public one.
 */
export function normalizeCalendarUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return null;
  // "https:///a.ics" would silently turn "a.ics" into the host: refuse a link whose host part is empty.
  if (/^[a-z][a-z0-9+.-]*:[/\\]{3,}/i.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed.replace(/^webcal:\/\//i, "https://"));
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.port !== "") return null; // the URL parser already drops an explicit 443
  if (url.hostname === "") return null;
  const literal = hostForLookup(url);
  if (isIP(literal) !== 0 && !isPublicAddress(literal)) return null;
  return url;
}

// An IPv6 literal comes with brackets in `hostname`.
function hostForLookup(url: URL): string {
  const host = url.hostname;
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

type HopOutcome =
  | { kind: "body"; text: string }
  | { kind: "redirect"; location: string }
  | { kind: "fail"; reason: FetchFailure };

interface Settings {
  lookup: (hostname: string) => Promise<{ address: string; family: number }[]>;
  isAllowedAddress: (ip: string) => boolean;
  maxBytes: number;
  maxRedirects: number;
  request: typeof http.request;
  port: number;
}

/** Never throws; the reason tells the caller what to tell the user. */
export async function fetchCalendarText(url: URL, options: FetchOptions = {}): Promise<FetchResult> {
  const settings: Settings = {
    lookup: options.lookup ?? ((host) => dnsPromises.lookup(host, { all: true, verbatim: true })),
    isAllowedAddress: options.isAllowedAddress ?? isPublicAddress,
    maxBytes: options.maxBytes ?? MAX_CALENDAR_BYTES,
    maxRedirects: options.maxRedirects ?? MAX_REDIRECTS,
    request: options.transport?.request ?? (https.request as typeof http.request),
    port: options.transport?.port ?? 443,
  };
  const state: { expired: boolean; active: http.ClientRequest | null } = { expired: false, active: null };
  let timer: NodeJS.Timeout | undefined;
  // One deadline for everything, redirects included.
  const deadline = new Promise<FetchResult>((resolve) => {
    timer = setTimeout(() => {
      state.expired = true;
      state.active?.destroy();
      resolve({ ok: false, reason: "unreachable" });
    }, options.timeoutMs ?? FETCH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([followLinks(url, settings, state), deadline]);
  } catch {
    return { ok: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

async function followLinks(
  start: URL,
  settings: Settings,
  state: { expired: boolean; active: http.ClientRequest | null },
): Promise<FetchResult> {
  try {
    let current = start;
    for (let redirects = 0; ; redirects++) {
      // Every hop gets the full checks again: a redirect may lead anywhere.
      const checked = normalizeCalendarUrl(current.href);
      if (checked === null) return { ok: false, reason: "invalid_link" };
      const host = hostForLookup(checked);
      let addresses: { address: string; family: number }[];
      try {
        addresses = await settings.lookup(host);
      } catch {
        return { ok: false, reason: "unreachable" };
      }
      if (state.expired) return { ok: false, reason: "unreachable" };
      const first = addresses[0];
      if (first === undefined) return { ok: false, reason: "unreachable" };
      // ANY private answer refuses the host, so a name cannot hide a private address among public ones.
      if (!addresses.every((entry) => settings.isAllowedAddress(entry.address))) {
        return { ok: false, reason: "blocked_address" };
      }
      const outcome = await requestOnce(checked, host, first, settings, state);
      if (outcome.kind === "body") return { ok: true, text: outcome.text };
      if (outcome.kind === "fail") return { ok: false, reason: outcome.reason };
      if (redirects >= settings.maxRedirects) return { ok: false, reason: "unreachable" };
      try {
        current = new URL(outcome.location, checked);
      } catch {
        return { ok: false, reason: "invalid_link" };
      }
    }
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

// One request to exactly the address that was checked. `hostname` stays the name, so the certificate check and
// SNI use the name, while the pinned `lookup` hands out only the checked address: no second DNS answer can
// slip in between the check and the connection.
function requestOnce(
  url: URL,
  host: string,
  target: { address: string; family: number },
  settings: Settings,
  state: { expired: boolean; active: http.ClientRequest | null },
): Promise<HopOutcome> {
  return new Promise<HopOutcome>((resolve) => {
    let done = false;
    const finish = (outcome: HopOutcome): void => {
      if (done) return;
      done = true;
      req?.destroy();
      state.active = null;
      resolve(outcome);
    };
    const pinnedLookup = (
      _hostname: string,
      lookupOptions: LookupOptions,
      callback: (...args: unknown[]) => void,
    ): void => {
      if (lookupOptions.all) callback(null, [{ address: target.address, family: target.family }]);
      else callback(null, target.address, target.family);
    };
    let req: http.ClientRequest | undefined;
    try {
      req = settings.request(
        {
          method: "GET",
          hostname: host,
          port: settings.port,
          path: url.pathname + url.search,
          lookup: pinnedLookup as never,
          agent: false,
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/calendar, */*;q=0.5",
            "Accept-Encoding": "identity",
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (REDIRECT_STATUSES.has(status)) {
            const location = res.headers.location;
            finish(location ? { kind: "redirect", location } : { kind: "fail", reason: "unreachable" });
            return;
          }
          if (GONE_STATUSES.has(status)) return finish({ kind: "fail", reason: "gone" });
          if (status !== 200) return finish({ kind: "fail", reason: "unreachable" });
          const declared = Number(res.headers["content-length"]);
          if (Number.isFinite(declared) && declared > settings.maxBytes) {
            return finish({ kind: "fail", reason: "too_large" });
          }
          const chunks: Buffer[] = [];
          let total = 0;
          res.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > settings.maxBytes) {
              finish({ kind: "fail", reason: "too_large" });
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(Buffer.concat(chunks));
            finish({ kind: "body", text: text.replace(/^﻿/, "") });
          });
          // Connection lost or aborted before the end.
          res.on("error", () => finish({ kind: "fail", reason: "unreachable" }));
          res.on("close", () => finish({ kind: "fail", reason: "unreachable" }));
        },
      );
    } catch {
      finish({ kind: "fail", reason: "unreachable" });
      return;
    }
    state.active = req;
    req.on("error", () => finish({ kind: "fail", reason: "unreachable" }));
    req.end();
  });
}
