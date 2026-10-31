import { buildApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp(config);

  const shutdown = (signal: string): void => {
    console.log(`${signal} received, shutting down`);
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(error);
        process.exit(1);
      },
    );
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await app.listen({ port: config.port, host: config.host });
  console.log(`Lückenfüller API ${config.appVersion} listening on ${config.host}:${config.port}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
});
