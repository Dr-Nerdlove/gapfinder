// The service worker: shows push messages and opens the poll when one is tapped. Built on its own by
// vite.sw.config.ts into dist/sw.js as one classic script (no import/export). No caching, no fetch handler.
import { notificationTarget, notificationText, parsePushPayload, pickWindow } from "./lib/notification-text";

declare const self: ServiceWorkerGlobalScope;

self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let raw: string | null = null;
  try {
    raw = event.data?.text() ?? null;
  } catch {
    // an unreadable message still gets the general text
  }
  const text = notificationText(parsePushPayload(raw)?.data);
  // Relative to the scope, so it works under /gapfinder/ on GitHub Pages.
  const icon = new URL("icon.png", self.registration.scope).href;
  event.waitUntil(
    self.registration.showNotification(text.title, {
      body: text.body,
      tag: text.tag,
      icon,
      // Android shows only the alpha channel of the badge: a separate white-on-transparent symbol.
      badge: new URL("badge.png", self.registration.scope).href,
      data: { shareToken: text.shareToken },
      lang: "de",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const token = (event.notification.data as { shareToken?: unknown } | null)?.shareToken;
  const shareToken = typeof token === "string" && token !== "" ? token : null;
  const scope = self.registration.scope;
  const url = notificationTarget(shareToken, scope);

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = pickWindow(windows, scope);
      if (open) {
        await open.focus().catch(() => undefined);
        // The app listens for this and changes its page; navigate() would reload it and lose what the person is doing.
        if (shareToken !== null) open.postMessage({ type: "open", hash: new URL(url).hash });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
