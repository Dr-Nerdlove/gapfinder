import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { APK_DOWNLOAD_URL, apkDownloadUrl, MANUAL_TEXT, availableText, installNote, isNewerVersion, isUnimplemented, loadAppUpdate, type AppUpdateApi } from "./app-update";

const answering = (state: "available" | "current" | "unknown", version?: string): AppUpdateApi => ({
  appUpdate: async () => ({ state, installedShell: 2, ...(version ? { version } : {}) }),
});
const rejecting = (error: unknown): AppUpdateApi => ({ appUpdate: async () => Promise.reject(error) });

describe("loadAppUpdate", () => {
  it("shows nothing outside the app and does not even ask", async () => {
    let asked = false;
    const api: AppUpdateApi = { appUpdate: async () => ((asked = true), { state: "available" as const, installedShell: 2, version: "1.7.0" }) };
    expect(await loadAppUpdate(false, api, "1.7.0")).toEqual({ kind: "none" });
    expect(asked).toBe(false);
  });

  it("offers the update with the version", async () => {
    expect(await loadAppUpdate(true, answering("available", "1.7.0"), "1.7.0")).toEqual({ kind: "available", version: "1.7.0" });
  });

  it("copes with an available update without a version", async () => {
    expect(await loadAppUpdate(true, answering("available"), "1.7.0")).toEqual({ kind: "available", version: null });
  });

  it("knows an app that is up to date", async () => {
    expect(await loadAppUpdate(true, answering("current"), "1.7.0")).toEqual({ kind: "none" });
  });

  it("shows nothing when the state is unknown", async () => {
    expect(await loadAppUpdate(true, answering("unknown"), "1.7.0")).toEqual({ kind: "none" });
  });

  it("asks for a manual install when the app has no appUpdate method (UNIMPLEMENTED)", async () => {
    expect(await loadAppUpdate(true, rejecting({ code: "UNIMPLEMENTED", message: "\"appUpdate\" is not implemented on android" }), "1.7.0")).toEqual({ kind: "manual" });
  });

  it("recognises the not-implemented message without a code", async () => {
    expect(await loadAppUpdate(true, rejecting(new Error("Lueckenfueller.appUpdate() is not implemented on android")), "1.7.0")).toEqual({ kind: "manual" });
  });

  it("shows nothing for a missing method while the web build is still the last release without self-update", async () => {
    const api = rejecting({ code: "UNIMPLEMENTED", message: "not implemented" });
    expect(await loadAppUpdate(true, api, "1.6.0")).toEqual({ kind: "none" });
    expect(await loadAppUpdate(true, api, "1.5.9")).toEqual({ kind: "none" });
  });

  it("asks for a manual install once the web build is newer than 1.6.0, compared per number", async () => {
    const api = rejecting({ code: "UNIMPLEMENTED", message: "not implemented" });
    expect(await loadAppUpdate(true, api, "1.7.0")).toEqual({ kind: "manual" });
    expect(await loadAppUpdate(true, api, "1.10.0")).toEqual({ kind: "manual" });
    expect(await loadAppUpdate(true, api, "2.0.0")).toEqual({ kind: "manual" });
  });

  it("shows nothing on any other error", async () => {
    expect(await loadAppUpdate(true, rejecting(new Error("Die App-Version ließ sich nicht prüfen.")), "1.7.0")).toEqual({ kind: "none" });
    expect(await loadAppUpdate(true, rejecting("boom"), "1.7.0")).toEqual({ kind: "none" });
  });
});

describe("isUnimplemented", () => {
  it("is false for things that are not that error", () => {
    expect(isUnimplemented(null)).toBe(false);
    expect(isUnimplemented(undefined)).toBe(false);
    expect(isUnimplemented({ code: "UNAVAILABLE" })).toBe(false);
  });
});

describe("texts", () => {
  it("names the version", () => {
    expect(availableText("1.7.0")).toBe("Version 1.7.0 der App ist da.");
    expect(availableText(null)).toBe("Eine neue Version der App ist da.");
  });

  it("explains the manual install", () => {
    expect(MANUAL_TEXT).toBe("Diese App-Version kann sich noch nicht selbst aktualisieren. Bitte installiere einmal die neue Version von der Release-Seite.");
  });

  it("has a note for every answer of the install", () => {
    expect(installNote({ result: "started" })).toBe("Android fragt gleich, ob du das Update installieren willst.");
    expect(installNote({ result: "needs-permission" })).toBe(
      "Bitte erlaube in den Einstellungen „Apps aus dieser Quelle installieren“ und tippe dann noch einmal auf „Aktualisieren“.",
    );
    expect(installNote({ result: "failed" })).toBe("Das Update hat nicht geklappt. Bitte später noch einmal versuchen.");
    expect(installNote(null)).toBe("Das Update hat nicht geklappt. Bitte später noch einmal versuchen.");
  });
});

describe("isNewerVersion", () => {
  it("compares number by number, not as text", () => {
    expect(isNewerVersion("1.10.0", "1.9.0")).toBe(true);
    expect(isNewerVersion("1.9.0", "1.10.0")).toBe(false);
    expect(isNewerVersion("1.6.1", "1.6.0")).toBe(true);
    expect(isNewerVersion("1.6.0", "1.6.0")).toBe(false);
    expect(isNewerVersion("2.0", "1.99.9")).toBe(true);
  });
});

describe("apkDownloadUrl", () => {
  it("links to the versioned APK of that release", () => {
    expect(apkDownloadUrl("2.0.0")).toBe("https://github.com/Dr-Nerdlove/gapfinder/releases/download/v2.0.0/lueckenfueller-2.0.0.apk");
  });

  it("uses the file name that app-update-json.sh prints and the Kotlin apkName builds", () => {
    const script = readFileSync(fileURLToPath(new URL("../../../scripts/app-update-json.sh", import.meta.url)), "utf8");
    expect(script).toContain('"apk":"lueckenfueller-%s.apk"');
    const kotlin = readFileSync(
      fileURLToPath(new URL("../../../android/app/src/main/kotlin/de/drnerdlove/lueckenfueller/AppUpdate.kt", import.meta.url)),
      "utf8",
    );
    expect(kotlin).toContain('fun apkName(version: String) = "lueckenfueller-$version.apk"');
    expect(apkDownloadUrl("3.1.4").split("/").pop()).toBe("lueckenfueller-3.1.4.apk");
  });

  it("the exported link belongs to the version in web/package.json", () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as { version: string };
    expect(APK_DOWNLOAD_URL).toBe(apkDownloadUrl(pkg.version));
    expect(APK_DOWNLOAD_URL).toContain(`/v${pkg.version}/lueckenfueller-${pkg.version}.apk`);
  });
});
