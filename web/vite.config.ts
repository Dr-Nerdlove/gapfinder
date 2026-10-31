import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

// `base: "./"` makes the built site work under any path, e.g. https://<user>.github.io/gapfinder/.
export default defineConfig({
  base: "./",
  plugins: [svelte()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The colour library uses extension-less imports that plain Node cannot load; let Vite process it.
    server: { deps: { inline: ["@material/material-color-utilities"] } },
  },
});
