import type { NotificationData } from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";
import { notificationTarget, notificationText, parsePushPayload, pickWindow } from "./notification-text";

const base = { pollTitle: "Grillen", shareToken: "tok_1" };
const P = { id: 1, start: "2026-12-12T13:00:00.000Z", end: "2026-12-12T16:00:00.000Z" };

describe("notificationText", () => {
  it("makes a text for every kind", () => {
    const t = (d: NotificationData) => notificationText(d);
    expect(t({ ...base, kind: "poll_created", actorName: "Anna" })).toEqual({
      title: "Neue Abstimmung: Grillen",
      body: "Anna fragt, wann du Zeit hast. Stimm jetzt ab.",
      shareToken: "tok_1",
      tag: "tok_1:poll_created",
    });
    expect(t({ ...base, kind: "vote", actorName: "Anna" })).toMatchObject({ title: "Grillen", body: "Anna hat abgestimmt.", tag: "tok_1:vote" });
    expect(t({ ...base, kind: "all_voted", actorName: "Ben" })).toMatchObject({
      title: "Alle haben abgestimmt: Grillen",
      body: "Zuletzt hat Ben abgestimmt.",
    });
    expect(t({ ...base, kind: "reminder", actorName: "Anna" })).toMatchObject({
      title: "Erinnerung: Grillen",
      body: "Anna bittet dich, abzustimmen.",
    });
    expect(t({ ...base, kind: "date_fixed", actorName: "Anna", proposal: P })).toMatchObject({
      title: "Termin steht: Grillen",
      body: "Anna hat den Termin festgelegt: Sa 12.12., 14:00–17:00.",
    });
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
    expect(notificationTarget("a b", "https://x.github.io/app/")).toBe("https://x.github.io/app/#/abstimmung/a%20b");
    expect(notificationTarget(null, "https://x.github.io/app/")).toBe("https://x.github.io/app/");
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
