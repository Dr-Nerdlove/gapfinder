import { describe, expect, it } from "vitest";
import cases from "./notification-text.cases.json";
import { notificationTarget, notificationText, parsePushPayload, pickWindow } from "./notification-text";

const base = { pollTitle: "Grillen", shareToken: "tok_1" };

describe("notificationText", () => {
  it("makes a text for every kind (cases shared with the Android app's test)", () => {
    expect(cases.texts.length).toBeGreaterThanOrEqual(5);
    for (const c of cases.texts) expect(notificationText(c.data), c.name).toEqual(c.expected);
  });

  it("does not throw on an unknown kind or broken data", () => {
    expect(notificationText({ ...base, kind: "something_new", actorName: "Anna" })).toEqual({
      title: "Lückenfüller",
      body: "Es gibt Neuigkeiten zu „Grillen“.",
      shareToken: "tok_1",
      tag: "tok_1:something_new",
    });
    for (const broken of [null, undefined, 5, "x", [], {}, { kind: "vote" }, { kind: "date_fixed", pollTitle: "A", actorName: "B" }, { kind: "date_fixed", pollTitle: "A", actorName: "B", proposal: { start: 1 } }]) {
      const text = notificationText(broken);
      expect(text.title.length).toBeGreaterThan(0);
      expect(text.body.length).toBeGreaterThan(0);
    }
    expect(notificationText(null)).toEqual({ title: "Lückenfüller", body: "Es gibt Neuigkeiten.", shareToken: null, tag: "lueckenfueller" });
    expect(notificationText({ pollTitle: "X", shareToken: "" }).shareToken).toBeNull();
    expect(notificationText({ pollTitle: 3, shareToken: 4 })).toMatchObject({ body: "Es gibt Neuigkeiten.", shareToken: null });
  });
});

describe("notificationTarget and pickWindow", () => {
  it("builds the poll address under the scope", () => {
    expect(cases.targets.length).toBeGreaterThanOrEqual(2);
    for (const c of cases.targets) expect(notificationTarget(c.shareToken, c.scope), c.name).toBe(c.url);
  });

  it("picks the first window inside the scope", () => {
    const clients = [{ url: "https://other.example/" }, { url: "https://x.github.io/app/#/profil" }, { url: "https://x.github.io/app/" }];
    expect(pickWindow(clients, "https://x.github.io/app/")).toBe(clients[1]);
    expect(pickWindow([], "https://x.github.io/app/")).toBeNull();
    expect(pickWindow(clients, "https://nope/")).toBeNull();
  });
});

describe("parsePushPayload", () => {
  it("reads a NotificationItem", () => {
    const item = { id: 4, createdAt: "2026-11-04T10:00:00.000Z", data: { ...base, kind: "vote", actorName: "Anna" } };
    expect(parsePushPayload(JSON.stringify(item))).toEqual(item);
  });
  it("gives null for empty or broken payloads", () => {
    for (const bad of [null, "", "{", "null", "5", '{"id":1}', '{"data":3}']) expect(parsePushPayload(bad)).toBeNull();
  });
});
