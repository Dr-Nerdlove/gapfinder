import { defineConfig } from "vite";

// The service worker is built apart from the app: it must be one classic script (Firefox and older Safari cannot
// run module workers) at the root of the site. Run after `vite build`, which empties dist first.
export default defineConfig({
  base: "./",
  publicDir: false,
  build: {
    lib: { entry: "src/sw.ts", formats: ["iife"], name: "lueckenfuellerWorker", fileName: () => "sw.js" },
    outDir: "dist",
    emptyOutDir: false,
    minify: true,
  },
});
