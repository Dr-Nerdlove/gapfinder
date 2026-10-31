import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses the defaults", () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      port: 8080,
      host: "0.0.0.0",
      dataDir: "./data",
      corsOrigins: ["http://localhost:5173"],
      appVersion: "dev",
      trustProxy: false,
      logLevel: "info",
    });
    expect(config.databasePath).toMatch(/lueckenfueller\.sqlite$/);
  });

  it("reads and trims a comma-separated origin list", () => {
    const config = loadConfig({
      PORT: "9000",
      DATA_DIR: "/data",
      CORS_ORIGIN: "https://a.example.github.io, http://localhost:5173",
      TRUST_PROXY: "true",
      APP_VERSION: "sha-abc1234",
    });
    expect(config.port).toBe(9000);
    expect(config.corsOrigins).toEqual(["https://a.example.github.io", "http://localhost:5173"]);
    expect(config.trustProxy).toBe(true);
    expect(config.appVersion).toBe("sha-abc1234");
    expect(config.databasePath).toBe("/data/lueckenfueller.sqlite");
  });

  it.each([
    [{ PORT: "abc" }, /PORT/],
    [{ PORT: "0" }, /PORT/],
    [{ PORT: "70000" }, /PORT/],
    [{ CORS_ORIGIN: "*" }, /CORS_ORIGIN/],
    [{ CORS_ORIGIN: "https://example.github.io/gapfinder/" }, /CORS_ORIGIN/],
    [{ CORS_ORIGIN: "not a url" }, /CORS_ORIGIN/],
    [{ TRUST_PROXY: "maybe" }, /TRUST_PROXY/],
    [{ LOG_LEVEL: "loud" }, /LOG_LEVEL/],
  ])("throws a clear error for invalid values %j", (env, message) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(message);
  });

  it("lists every problem at once", () => {
    expect(() => loadConfig({ PORT: "x", TRUST_PROXY: "y" })).toThrow(/PORT[\s\S]*TRUST_PROXY/);
  });
});
