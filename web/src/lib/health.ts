import type { HealthResponse } from "@lueckenfueller/shared";

export const HEALTH_TIMEOUT_MS = 5000;

export type OfflineReason = "timeout" | "network" | "http" | "invalid";

export type HealthResult =
  | { kind: "online"; version: string }
  | { kind: "offline"; reason: OfflineReason };

export interface HealthOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function isHealthResponse(value: unknown): value is HealthResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)["status"] === "ok" &&
    typeof (value as Record<string, unknown>)["version"] === "string"
  );
}

/** Asks the server whether it is up. Never throws: every failure becomes an `offline` result. */
export async function checkHealth(apiUrl: string, options: HealthOptions = {}): Promise<HealthResult> {
  const { timeoutMs = HEALTH_TIMEOUT_MS, fetchImpl = fetch } = options;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(`${apiUrl.replace(/\/+$/, "")}/api/health`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return { kind: "offline", reason: "http" };
    }
    const body: unknown = await response.json();
    return isHealthResponse(body) ? { kind: "online", version: body.version } : { kind: "offline", reason: "invalid" };
  } catch {
    return { kind: "offline", reason: timedOut ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}
