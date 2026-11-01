import type { CalendarProvider } from "@lueckenfueller/shared";

function isHostOrSubdomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

const OUTLOOK_HOSTS = new Set(["outlook.live.com", "outlook.office365.com", "outlook.office.com"]);

/** Who serves the calendar, told from the host name of its (already normalized) link. */
export function providerOfLink(link: URL): CalendarProvider {
  const host = link.hostname.toLowerCase().replace(/\.$/, "");
  if (isHostOrSubdomain(host, "google.com")) return "google";
  if (isHostOrSubdomain(host, "icloud.com")) return "apple";
  if (OUTLOOK_HOSTS.has(host) || isHostOrSubdomain(host, "outlook.com")) return "outlook";
  return "other";
}
