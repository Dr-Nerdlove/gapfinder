// Which IP addresses the server may connect to when it fetches a user's calendar link. The server is reachable
// from the internet and the links come from users, so anything that is not clearly a public internet address
// (home network, the VM, Docker, the Hyper-V host, Tailscale, loopback, ...) must be refused (SSRF protection).
import { isIP } from "node:net";

// IPv4 ranges that are not public: [network, prefix length].
const BLOCKED_V4: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT, also used by Tailscale
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link local (cloud metadata services live here)
  ["172.16.0.0", 12], // private (Docker)
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // old 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. 255.255.255.255
];

// Inside the global unicast range 2000::/3 these are still not for ordinary internet hosts: [first 16-bit
// groups of the network, prefix length].
const BLOCKED_V6: readonly (readonly [readonly number[], number])[] = [
  [[0x2001, 0x0000], 23], // 2001::/23 protocol assignments (Teredo, ...)
  [[0x2001, 0x0db8], 32], // documentation
  [[0x2002], 16], // 6to4 (embeds an IPv4 address that we do not check)
  [[0x3fff], 20], // documentation
];

/** True only for an address of the public internet. Anything that is not a valid IP address is not public. */
export function isPublicAddress(ip: string): boolean {
  // A zone id (fe80::1%eth0) only makes sense for link-local addresses, which are never public.
  if (ip.includes("%")) return false;
  const version = isIP(ip);
  if (version === 4) {
    const bytes = parseV4(ip);
    return bytes !== null && isPublicV4(bytes);
  }
  if (version === 6) {
    const groups = parseV6(ip);
    return groups !== null && isPublicV6(groups);
  }
  return false;
}

function parseV4(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : null;
}

function toNumber(bytes: readonly number[]): number {
  return ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
}

function isPublicV4(bytes: readonly number[]): boolean {
  const value = toNumber(bytes);
  return !BLOCKED_V4.some(([network, prefix]) => {
    const baseValue = toNumber(parseV4(network)!);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) >>> 0 === (baseValue & mask) >>> 0;
  });
}

/** The eight 16-bit groups of a valid IPv6 address (also with an embedded dotted IPv4 tail). */
function parseV6(text: string): number[] | null {
  let tail: number[] = [];
  let head = text;
  const lastColon = text.lastIndexOf(":");
  const last = text.slice(lastColon + 1);
  if (last.includes(".")) {
    const v4 = parseV4(last);
    if (v4 === null) return null;
    tail = [(v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!];
    head = text.slice(0, lastColon + 1) + "0:0"; // placeholder for the two groups
  }
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups = part.split(":").map((g) => (/^[0-9a-fA-F]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
    return groups.some(Number.isNaN) ? null : groups;
  };
  const left = toGroups(halves[0]!);
  const right = halves.length === 2 ? toGroups(halves[1]!) : [];
  if (left === null || right === null) return null;
  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    groups = [...left, ...new Array<number>(missing).fill(0), ...right];
  } else {
    groups = left;
  }
  if (groups.length !== 8) return null;
  if (tail.length === 2) groups.splice(6, 2, tail[0]!, tail[1]!);
  return groups;
}

function isPublicV6(groups: readonly number[]): boolean {
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): the embedded IPv4 address decides.
  const zeros = groups.slice(0, 5).every((g) => g === 0);
  if (zeros && (groups[5] === 0xffff || groups[5] === 0)) {
    const embedded = [groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff];
    return isPublicV4(embedded);
  }
  // Only global unicast 2000::/3 is public; everything else (loopback, link local, unique local incl.
  // Tailscale's fd7a:115c:a1e0::/48, multicast, NAT64, ...) is not.
  if ((groups[0]! & 0xe000) !== 0x2000) return false;
  return !BLOCKED_V6.some(([network, prefix]) => {
    let remaining = prefix;
    for (let i = 0; remaining > 0; i++) {
      const bits = Math.min(16, remaining);
      const mask = (0xffff << (16 - bits)) & 0xffff;
      if ((groups[i]! & mask) !== (network[i] ?? 0)) return false;
      remaining -= bits;
    }
    return true;
  });
}
