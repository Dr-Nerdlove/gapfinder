import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { startSession } from "./lib/session.svelte";
import { loadSeed } from "./lib/session-storage";
import { startTheme } from "./lib/theme";

// The last seed colour is applied first, so the right colours show before the server has answered.
const theme = startTheme(loadSeed());

mount(App, { target: document.getElementById("app")! });

void startSession((user) => theme.setSeed(user?.seedColor));
