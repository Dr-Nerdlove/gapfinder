/** Base URL of the API server without a trailing slash. */
export const API_URL: string = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");
