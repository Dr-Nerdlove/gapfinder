/** Base URL of the API server without a trailing slash. */
export const API_URL: string = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");

/** Release number of this app, e.g. "1.0.0". */
export const APP_RELEASE: string = __APP_RELEASE__;

/** Commit of this app build, e.g. "sha-1a2b3c4"; "dev" when not built by the deploy workflow. */
export const APP_BUILD: string = __APP_BUILD__;
