import cors from "@fastify/cors";
import type { HealthResponse } from "@lueckenfueller/shared";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Writable } from "node:stream";
import { purgeExpired } from "./accounts/cleanup.js";
import { RateLimiter } from "./auth/rate-limit.js";
import type { Config } from "./config.js";
import type { AppContext } from "./context.js";
import { openDatabase } from "./db.js";
import { errorHandler, notFoundHandler } from "./errors.js";
import { maskTokens } from "./log-masking.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerInviteRoutes } from "./routes/invites.js";
import { registerMeRoutes } from "./routes/me.js";
import { registerPasswordResetRoutes } from "./routes/password-resets.js";

const BODY_LIMIT_BYTES = 64 * 1024;

export interface BuildAppOptions {
  /** The clock; tests move it to check expiry and rate limit windows. */
  now?: () => Date;
  /** Use this database instead of opening `config.databasePath` (tests). The app closes it with itself. */
  db?: DatabaseSync;
  /** Where the log goes instead of standard output (tests). */
  logStream?: Writable;
}

/** Builds the server without listening, so tests can use `app.inject`. */
export async function buildApp(config: Config, options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const now = options.now ?? (() => new Date());
  const serverOptions: FastifyServerOptions = {
    logger: {
      level: config.logLevel,
      // Never log invite or password reset tokens (they are in the URL), headers or bodies.
      serializers: {
        req: (request) => ({
          method: request.method,
          url: maskTokens(request.url),
          host: request.host,
          remoteAddress: request.ip,
        }),
      },
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
    trustProxy: config.trustProxy,
    bodyLimit: BODY_LIMIT_BYTES,
    // A number sent where text is expected is an error, not silently turned into text.
    ajv: { customOptions: { coerceTypes: false } },
  };
  const app = Fastify(serverOptions);

  const db = options.db ?? openDatabase(config.databasePath);
  app.addHook("onClose", async () => {
    db.close();
  });
  const ctx: AppContext = { config, db, now, limiter: new RateLimiter(now) };
  purgeExpired(db, now());

  // A JSON content type without a body (e.g. logout) is an empty request, not a syntax error.
  const parseJson = app.getDefaultJsonParser("error", "error");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    if (typeof body === "string" && body.trim() === "") {
      done(null, {});
      return;
    }
    parseJson(request, body as string, done);
  });

  app.decorateRequest("auth", null);

  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    maxAge: 600,
    exposedHeaders: ["Retry-After"],
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  app.get(
    "/api/health",
    async (): Promise<HealthResponse> => ({
      status: "ok",
      version: config.appVersion,
      time: now().toISOString(),
    }),
  );

  registerAuthRoutes(app, ctx);
  registerMeRoutes(app, ctx);
  registerInviteRoutes(app, ctx);
  registerPasswordResetRoutes(app, ctx);
  registerAdminRoutes(app, ctx);

  return app;
}
