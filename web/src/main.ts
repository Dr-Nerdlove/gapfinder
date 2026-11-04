import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { WORKER_SCOPE, WORKER_URL } from "./lib/push";
import { navigate } from "./lib/router";
import { startSession } from "./lib/session.svelte";
import { loadSeed } from "./lib/session-storage";
import { startTheme } from "./lib/theme";
import { openHashOf } from "./lib/worker-message";

// The last seed colour is applied first, so the right colours show before the server has answered.
const theme = startTheme(loadSeed());

mount(App, { target: document.getElementById("app")! });

void startSession((user) => theme.setSeed(user?.seedColor));

// The service worker shows push messages. Only in the real build: in development it would get in the way.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
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
