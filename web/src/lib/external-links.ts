/**
 * Where a link should be opened outside the app, or null when it stays in the app.
 * Stays: hash links, links inside this app's own folder (same origin) and everything unknown. Goes out: other http/https
 * sites, `webcal:`, `mailto:` and `tel:`.
 */
export function externalLinkTarget(href: string, pageUrl: string): string | null {
  let url: URL;
  let page: URL;
  try {
    page = new URL(pageUrl);
    url = new URL(href, page);
  } catch {
    return null;
  }
  switch (url.protocol) {
    case "http:":
    case "https:":
      // GitHub Pages serves other projects under the same origin: only this app's own folder stays.
      return url.origin === page.origin && url.pathname.startsWith(new URL("./", page).pathname) ? null : url.href;
    case "webcal:":
    case "mailto:":
    case "tel:":
      return url.href;
    default:
      return null;
  }
}

export interface LinkClickEvent {
  target: unknown;
  preventDefault(): void;
}

/** Click handler: sends links to other sites out of the app. */
export function handleLinkClick(event: LinkClickEvent, pageUrl: string, open: (url: string) => void): void {
  const target = event.target as { closest?: (selector: string) => { getAttribute(name: string): string | null } | null } | null;
  const anchor = typeof target?.closest === "function" ? target.closest("a[href]") : null;
  const href = anchor?.getAttribute("href");
  if (!href) return;
  const url = externalLinkTarget(href, pageUrl);
  if (url === null) return;
  event.preventDefault();
  open(url);
}

/** Installs one capture-phase listener; the caller does this only inside the Android app. */
export function installExternalLinks(doc: Document, pageUrl: () => string, open: (url: string) => void): void {
  doc.addEventListener("click", (event) => handleLinkClick(event, pageUrl(), open), true);
}
