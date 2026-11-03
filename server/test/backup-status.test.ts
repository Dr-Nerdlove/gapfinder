import type { ApiErrorBody, BackupStatus } from "@lueckenfueller/shared";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseBackupStatus, readBackupStatus } from "../src/backup-status.js";
import { addUserWithSession, call, createTestEnv, type TestEnv } from "./helpers.js";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "backup-status-"));
  dirs.push(dir);
  return dir;
}

let env: TestEnv | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("parseBackupStatus", () => {
  it("reads the three times", () => {
    const status = parseBackupStatus(
      "last_backup=2026-11-03T00:31:07Z\nlast_copy=2026-11-03T00:31:20Z\nlast_check=2026-10-20T18:00:00Z\n",
    );
    expect(status).toEqual({
      known: true,
      lastBackupAt: "2026-11-03T00:31:07.000Z",
      lastCopyAt: "2026-11-03T00:31:20.000Z",
      lastCheckAt: "2026-10-20T18:00:00.000Z",
    });
  });

  it("treats a missing key as null", () => {
    expect(parseBackupStatus("last_backup=2026-11-03T00:31:07Z\n")).toEqual({
      known: true,
      lastBackupAt: "2026-11-03T00:31:07.000Z",
      lastCopyAt: null,
      lastCheckAt: null,
    });
  });

  it("treats an empty file as known with no times", () => {
    expect(parseBackupStatus("")).toEqual({ known: true, lastBackupAt: null, lastCopyAt: null, lastCheckAt: null });
  });

  it("turns values that are not dates into null", () => {
    const status = parseBackupStatus("last_backup=yesterday\nlast_copy=\nlast_check=2026-13-45T99:00:00Z\n");
    expect(status).toEqual({ known: true, lastBackupAt: null, lastCopyAt: null, lastCheckAt: null });
  });

  it("ignores unknown keys, lines without a key, comments and Windows line ends", () => {
    const status = parseBackupStatus(
      "# comment\nnonsense\n=novalue\nsecret=hunter2\r\nlast_copy=2026-11-03T00:31:20Z\r\n\n  \n",
    );
    expect(status).toEqual({
      known: true,
      lastBackupAt: null,
      lastCopyAt: "2026-11-03T00:31:20.000Z",
      lastCheckAt: null,
    });
    expect(JSON.stringify(status)).not.toContain("hunter2");
  });

  it("uses the last of two lines with the same key", () => {
    const status = parseBackupStatus("last_backup=2026-01-01T00:00:00Z\nlast_backup=2026-02-02T00:00:00Z\n");
    expect(status.lastBackupAt).toBe("2026-02-02T00:00:00.000Z");
  });

  it("does not throw on binary garbage", () => {
    expect(() => parseBackupStatus("\u0000\u0001�=\n=\n\u0000=\u0000")).not.toThrow();
  });
});

describe("readBackupStatus", () => {
  it("is not known when the file does not exist", async () => {
    expect(await readBackupStatus(tempDir())).toEqual({
      known: false,
      lastBackupAt: null,
      lastCopyAt: null,
      lastCheckAt: null,
    });
  });

  it("is not known when the data folder does not exist", async () => {
    expect((await readBackupStatus(join(tempDir(), "missing"))).known).toBe(false);
  });

  it("is not known when the file cannot be read as a file", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, "backup-status"));
    expect((await readBackupStatus(dir)).known).toBe(false);
  });

  it("reads the file on every call", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "backup-status"), "last_backup=2026-11-03T00:31:07Z\n");
    expect((await readBackupStatus(dir)).lastBackupAt).toBe("2026-11-03T00:31:07.000Z");
    writeFileSync(join(dir, "backup-status"), "last_backup=2026-11-04T00:31:07Z\n");
    expect((await readBackupStatus(dir)).lastBackupAt).toBe("2026-11-04T00:31:07.000Z");
  });
});

describe("GET /api/admin/backup-status", () => {
  async function setup(dataDir: string) {
    env = await createTestEnv({ dataDir });
    const admin = await addUserWithSession(env, "Admin A.", { isAdmin: true });
    const friend = await addUserWithSession(env, "Vincent R.");
    return { e: env, admin, friend };
  }

  it("gives the admin the status from the file", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "backup-status"), "last_backup=2026-11-03T00:31:07Z\nlast_check=2026-10-01T10:00:00Z\n");
    const { e, admin } = await setup(dir);
    const response = await call(e, "GET", "/api/admin/backup-status", { token: admin.token });
    expect(response.statusCode).toBe(200);
    expect(response.json<BackupStatus>()).toEqual({
      known: true,
      lastBackupAt: "2026-11-03T00:31:07.000Z",
      lastCopyAt: null,
      lastCheckAt: "2026-10-01T10:00:00.000Z",
    });
  });

  it("says known: false when there is no file, and keeps working", async () => {
    const { e, admin } = await setup(tempDir());
    const response = await call(e, "GET", "/api/admin/backup-status", { token: admin.token });
    expect(response.statusCode).toBe(200);
    expect(response.json<BackupStatus>().known).toBe(false);
    expect((await call(e, "GET", "/api/admin/users", { token: admin.token })).statusCode).toBe(200);
  });

  it("answers 403 for a normal user", async () => {
    const { e, friend } = await setup(tempDir());
    const response = await call(e, "GET", "/api/admin/backup-status", { token: friend.token });
    expect(response.statusCode).toBe(403);
    expect(response.json<ApiErrorBody>().code).toBe("forbidden");
  });

  it("answers 401 without a login", async () => {
    const { e } = await setup(tempDir());
    const response = await call(e, "GET", "/api/admin/backup-status");
    expect(response.statusCode).toBe(401);
  });
});
