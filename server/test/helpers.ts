import type { Config } from "../src/config.js";

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    host: "127.0.0.1",
    dataDir: ":memory:",
    databasePath: ":memory:",
    corsOrigins: ["https://friends.example.github.io"],
    appVersion: "test",
    trustProxy: false,
    logLevel: "silent",
    ...overrides,
  };
}
