import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { startTheme } from "./lib/theme";

startTheme();

mount(App, { target: document.getElementById("app")! });
