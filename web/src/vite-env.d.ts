/// <reference types="vite/client" />
/// <reference types="svelte" />

interface ImportMetaEnv {
  /** Base URL of the API server, e.g. https://lueckenfueller.example.ts.net */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Release number of this build, e.g. "1.0.0" (from web/package.json). */
declare const __APP_RELEASE__: string;
/** Commit of this build, e.g. "sha-1a2b3c4", or "dev" when not built by the deploy workflow. */
declare const __APP_BUILD__: string;
