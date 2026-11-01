import { STATUS_CODES } from "node:http";
import type { ApiErrorBody, ErrorCode } from "@lueckenfueller/shared";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

/** An error that the API reports to the caller as `ApiErrorBody`. */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly field: string | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(statusCode: number, code: ErrorCode, extra: { field?: string; retryAfterSeconds?: number } = {}) {
    super(code);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.field = extra.field;
    this.retryAfterSeconds = extra.retryAfterSeconds;
  }
}

export const unauthorized = (): ApiError => new ApiError(401, "unauthorized");
export const forbidden = (): ApiError => new ApiError(403, "forbidden");
export const notFound = (): ApiError => new ApiError(404, "not_found");
export const validation = (field: string): ApiError => new ApiError(400, "validation", { field });
export const rateLimited = (retryAfterSeconds: number): ApiError =>
  new ApiError(429, "rate_limited", { retryAfterSeconds });

function body(statusCode: number, code: ErrorCode, field?: string, retryAfterSeconds?: number): ApiErrorBody {
  const result: ApiErrorBody = { statusCode, error: STATUS_CODES[statusCode] ?? "Request Error", code };
  if (field !== undefined) result.field = field;
  if (retryAfterSeconds !== undefined) result.retryAfterSeconds = retryAfterSeconds;
  return result;
}

/** The body field a Fastify schema error is about, when it can be told. */
function validationField(error: FastifyError): string | undefined {
  const first = error.validation?.[0];
  if (!first) return undefined;
  const params = first.params as { missingProperty?: unknown } | undefined;
  if (typeof params?.missingProperty === "string") return params.missingProperty;
  const name = first.instancePath.split("/").filter((part) => part !== "")[0];
  return name === undefined ? undefined : name.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** Every error leaves the server as `ApiErrorBody`; server errors never reveal details. */
export function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (error instanceof ApiError) {
    if (error.retryAfterSeconds !== undefined) {
      void reply.header("Retry-After", String(error.retryAfterSeconds));
    }
    return reply
      .status(error.statusCode)
      .send(body(error.statusCode, error.code, error.field, error.retryAfterSeconds));
  }

  const statusCode =
    typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : 500;
  if (statusCode >= 500 || statusCode < 400) {
    request.log.error(error);
    return reply.status(500).send(body(500, "error"));
  }
  const fastifyError = error as FastifyError;
  if (fastifyError.validation) {
    return reply.status(400).send(body(400, "validation", validationField(fastifyError)));
  }
  const code: ErrorCode = statusCode === 400 ? "validation" : statusCode === 404 ? "not_found" : "error";
  return reply.status(statusCode).send(body(statusCode, code));
}

export function notFoundHandler(_request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply.status(404).send(body(404, "not_found"));
}
