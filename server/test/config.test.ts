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
      appUrl: "http://localhost:5173/",
      logLevel: "info",
      calendarKey: null,
      calendarKeyProblem: "CALENDAR_KEY is not set",
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
    [{ APP_URL: "ftp://example.com/app/" }, /APP_URL/],
    [{ APP_URL: "not a url" }, /APP_URL/],
    [{ APP_URL: "https://example.github.io/app/#/start" }, /APP_URL/],
    [{ APP_URL: "https://example.github.io/app/#" }, /APP_URL/],
    [{ APP_URL: "https://example.github.io/app/?x=1" }, /APP_URL/],
  ])("throws a clear error for invalid values %j", (env, message) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(message);
  });

  it("always ends APP_URL with a slash and keeps its path", () => {
    expect(loadConfig({ APP_URL: "https://dr-nerdlove.github.io/gapfinder" }).appUrl).toBe(
      "https://dr-nerdlove.github.io/gapfinder/",
    );
    expect(loadConfig({ APP_URL: "https://dr-nerdlove.github.io/gapfinder/" }).appUrl).toBe(
      "https://dr-nerdlove.github.io/gapfinder/",
    );
    expect(loadConfig({ APP_URL: "http://localhost:5173" }).appUrl).toBe("http://localhost:5173/");
  });

  it("falls back to the default when APP_URL is empty (the Docker image sets it empty without a build argument)", () => {
    expect(loadConfig({ APP_URL: "" }).appUrl).toBe("http://localhost:5173/");
  });

  it("lists every problem at once", () => {
    expect(() => loadConfig({ PORT: "x", TRUST_PROXY: "y" })).toThrow(/PORT[\s\S]*TRUST_PROXY/);
  });

  describe("CALENDAR_KEY", () => {
    const bytes = Buffer.from(Array.from({ length: 32 }, (_, i) => i * 7));
    const valid = bytes.toString("base64");

    it("reads a valid key, trimmed", () => {
      for (const text of [valid, `  ${valid}\n`]) {
        const config = loadConfig({ CALENDAR_KEY: text });
        expect(config.calendarKey?.equals(bytes)).toBe(true);
        expect(config.calendarKeyProblem).toBeNull();
      }
    });

    it("is not configured when unset or empty", () => {
      for (const env of [{}, { CALENDAR_KEY: "" }, { CALENDAR_KEY: "   " }]) {
        expect(loadConfig(env)).toMatchObject({ calendarKey: null, calendarKeyProblem: "CALENDAR_KEY is not set" });
      }
    });

    it.each([
      ["too short", Buffer.alloc(16, 5).toString("base64")],
      ["too long", Buffer.alloc(33, 5).toString("base64")],
      ["not base64", "this is not a key, definitely!!"],
      ["without padding", valid.replace(/=+$/, "") + "A"],
      ["url-safe alphabet", Buffer.alloc(32, 0xfb).toString("base64url")],
      ["trailing bits set (not canonical)", Buffer.alloc(32, 0).toString("base64").replace("A=", "B=")],
      ["extra characters inside", `${valid.slice(0, 10)} ${valid.slice(10)}`],
    ])("rejects a key that is %s without throwing and without leaking it", (_name, value) => {
      let config;
      expect(() => {
        config = loadConfig({ CALENDAR_KEY: value });
      }).not.toThrow();
      expect(config).toMatchObject({ calendarKey: null });
      const problem = (config as unknown as { calendarKeyProblem: string | null }).calendarKeyProblem;
      expect(problem).toMatch(/^CALENDAR_KEY is not valid/);
      expect(problem).not.toContain(value.trim());
    });

    it("never turns a bad key into a ConfigError, also next to other valid settings", () => {
      expect(() => loadConfig({ CALENDAR_KEY: "x", PORT: "9000" })).not.toThrow();
    });
  });
});
