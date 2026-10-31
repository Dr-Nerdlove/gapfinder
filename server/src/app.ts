import cors from "@fastify/cors";
import type { HealthResponse } from "@lueckenfueller/shared";
import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import { openDatabase } from "./db.js";

const BODY_LIMIT_BYTES = 64 * 1024;

/** Builds the server without listening, so tests can use `app.inject`. */
export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: config.trustProxy,
    bodyLimit: BODY_LIMIT_BYTES,
  });

  const db = openDatabase(config.databasePath);
  app.addHook("onClose", async () => {
    db.close();
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    maxAge: 600,
  });

  // Never leak internals: server errors get a generic message, client errors keep Fastify's short message.
  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    if (statusCode >= 500) {
      request.log.error(error);
      return reply.status(500).send({ statusCode: 500, error: "Internal Server Error" });
    }
    const message = error instanceof Error ? error.message : "Bad Request";
    return reply.status(statusCode).send({ statusCode, error: "Request Error", message });
  });

  app.get("/api/health", async (): Promise<HealthResponse> => ({
    status: "ok",
    version: config.appVersion,
    time: new Date().toISOString(),
  }));

  return app;
}
