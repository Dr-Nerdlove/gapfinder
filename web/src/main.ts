import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { installExternalLinks } from "./lib/external-links";
import { Lueckenfueller, isAndroidApp } from "./lib/native";
import { WORKER_SCOPE, WORKER_URL } from "./lib/push";
import { navigate } from "./lib/router";
import { startSession } from "./lib/session.svelte";
import { loadSeed } from "./lib/session-storage";
import { startTheme } from "./lib/theme";
import { createThemeChoice } from "./lib/theme-choice";
import { watchThemeChoice } from "./lib/theme-state.svelte";
import { openHashOf } from "./lib/worker-message";

// The last colours are applied first, so the right ones show before the server (or the app) has answered: inside
// the Android app the phone's colours (when available and not switched off), otherwise the last seed colour.
const colors = createThemeChoice({
  inApp: isAndroidApp(),
  read: async () => Lueckenfueller.systemColors(),
  seed: loadSeed(),
});
watchThemeChoice(colors);
startTheme(colors);

// Inside the Android app, links to other sites open in the browser or the matching app.
if (isAndroidApp()) {
  installExternalLinks(document, () => window.location.href, (url) => {
    void Lueckenfueller.openExternal({ url }).catch(() => undefined);
  });
}

mount(App, { target: document.getElementById("app")! });

void startSession((user) => colors.setSeed(user?.seedColor));

// The service worker shows push messages. Only in the real build: in development it would get in the way.
// Not inside the Android app: it shows its notifications natively.
if (import.meta.env.PROD && !isAndroidApp() && "serviceWorker" in navigator) {
  const register = (): void => {
    navigator.serviceWorker.register(WORKER_URL, { scope: WORKER_SCOPE }).catch(() => undefined);
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });

  // A tap on a message while the app is open: the worker asks the app to change its page.
  navigator.serviceWorker.addEventListener("message", (event) => {
    const hash = openHashOf(event.data);
    if (hash !== null) navigate(hash);
  });
}
