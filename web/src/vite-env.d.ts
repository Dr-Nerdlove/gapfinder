/// <reference types="vite/client" />
/// <reference types="svelte" />

interface ImportMetaEnv {
  /** Base URL of the API server, e.g. https://lueckenfueller.example.ts.net */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
