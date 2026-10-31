/** Version of the HTTP API. Increase only for breaking changes; the server must stay backward compatible. */
export const API_VERSION = 1;

/** Response of `GET /api/health`. */
export interface HealthResponse {
  status: "ok";
  /** Version of the running server (the image's `APP_VERSION`). */
  version: string;
  /** Server time as ISO 8601 string (UTC). */
  time: string;
}
