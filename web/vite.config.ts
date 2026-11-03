import { readFileSync } from "node:fs";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// `base: "./"` makes the built site work under any path, e.g. https://<user>.github.io/gapfinder/.
export default defineConfig({
  base: "./",
  plugins: [svelte()],
  define: {
    // Release number (from package.json) and the commit this build was made from ("sha-1a2b3c4", set by deploy.yml;
    // "dev" elsewhere). The commit is compared with the one the server reports, to tell whether the server is up to date.
    __APP_RELEASE__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(process.env["APP_BUILD"] ?? "dev"),
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The colour library uses extension-less imports that plain Node cannot load; let Vite process it.
    server: { deps: { inline: ["@material/material-color-utilities"] } },
  },
});
