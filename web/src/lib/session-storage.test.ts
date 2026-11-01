import { describe, expect, it } from "vitest";
import {
  clearSession,
  loadSeed,
  loadSession,
  saveSeed,
  saveSession,
  SEED_KEY,
  SESSION_KEY,
} from "./session-storage";
import { brokenStorage, MemoryStorage } from "./test-storage";

const user = { id: 1, username: "Vincent R.", isAdmin: true, seedColor: "#1e63d6" };

describe("session storage", () => {
  it("saves and loads the token with the last known user", () => {
    const storage = new MemoryStorage();
    saveSession({ token: "tok", user }, storage);
    expect(loadSession(storage)).toEqual({ token: "tok", user });
  });

  it("loads nothing when nothing is saved", () => {
    expect(loadSession(new MemoryStorage())).toBeNull();
  });

  it("forgets the login", () => {
    const storage = new MemoryStorage();
    saveSession({ token: "tok", user }, storage);
    clearSession(storage);
    expect(loadSession(storage)).toBeNull();
    expect(storage.getItem(SESSION_KEY)).toBeNull();
  });

  it.each(["{not json", "null", "[]", '"text"', "{}", '{"token":"t"}', '{"token":"","user":{}}', '{"token":"t","user":{"id":"1"}}'])(
    "ignores broken content %j",
    (raw) => {
      const storage = new MemoryStorage();
      storage.setItem(SESSION_KEY, raw);
      expect(loadSession(storage)).toBeNull();
    },
  );

  it("works without storage", () => {
    expect(() => saveSession({ token: "t", user }, null)).not.toThrow();
    expect(loadSession(null)).toBeNull();
    expect(() => clearSession(null)).not.toThrow();
    expect(loadSeed(null)).toBeNull();
    expect(() => saveSeed("#112233", null)).not.toThrow();
  });

  it("survives a storage that throws on every access", () => {
    expect(() => saveSession({ token: "t", user }, brokenStorage)).not.toThrow();
    expect(loadSession(brokenStorage)).toBeNull();
    expect(() => clearSession(brokenStorage)).not.toThrow();
    expect(loadSeed(brokenStorage)).toBeNull();
    expect(() => saveSeed("#112233", brokenStorage)).not.toThrow();
  });

  it("remembers and forgets the seed colour", () => {
    const storage = new MemoryStorage();
    saveSeed("#1e63d6", storage);
    expect(loadSeed(storage)).toBe("#1e63d6");
    expect(storage.getItem(SEED_KEY)).toBe("#1e63d6");
    saveSeed(null, storage);
    expect(loadSeed(storage)).toBeNull();
  });
});
