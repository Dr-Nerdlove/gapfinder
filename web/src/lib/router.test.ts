import { describe, expect, it } from "vitest";
import { goToStart, navigate, parseRoute, watchRoute, type Route } from "./router";

describe("parseRoute", () => {
  it.each(["", "#", "#/", "#/?utm=1"])("maps %j to the start page", (hash) => {
    expect(parseRoute(hash)).toEqual({ name: "start" });
  });

  it.each([
    ["#/anmelden", { name: "login" }],
    ["#/anmelden/", { name: "login" }],
    ["#/profil", { name: "profile" }],
    ["#/kalender", { name: "calendars" }],
    ["#/kalender/", { name: "calendars" }],
    ["#/kalender?x=1", { name: "calendars" }],
    ["#/suche", { name: "search" }],
    ["#/suche/", { name: "search" }],
    ["#/suche?x=1", { name: "search" }],
    ["#/verwaltung", { name: "admin" }],
    ["#/verwaltung?x=1", { name: "admin" }],
    ["#/privatsphaere", { name: "privacy" }],
    ["#/privatsphaere/", { name: "privacy" }],
  ])("maps %j to its page", (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });

  it("reads the token of an invite link", () => {
    expect(parseRoute("#/einladung/aB3_-xY9")).toEqual({ name: "invite", token: "aB3_-xY9" });
    expect(parseRoute("#/einladung/aB3_-xY9/")).toEqual({ name: "invite", token: "aB3_-xY9" });
  });

  it("maps the poll pages", () => {
    expect(parseRoute("#/abstimmungen")).toEqual({ name: "polls" });
    expect(parseRoute("#/abstimmungen/")).toEqual({ name: "polls" });
    expect(parseRoute("#/abstimmung-neu")).toEqual({ name: "poll-new" });
  });

  it("reads the share token of a poll link", () => {
    expect(parseRoute("#/abstimmung/aB3_-xY9")).toEqual({ name: "poll", token: "aB3_-xY9" });
    expect(parseRoute("#/abstimmung/aB3_-xY9/")).toEqual({ name: "poll", token: "aB3_-xY9" });
    expect(parseRoute("#/abstimmung/aB3_-xY9?x=1")).toEqual({ name: "poll", token: "aB3_-xY9" });
    expect(parseRoute("#/abstimmung/")).toEqual({ name: "not-found" });
    expect(parseRoute("#/abstimmung/a b")).toEqual({ name: "not-found" });
    expect(parseRoute("#/abstimmung/a/b")).toEqual({ name: "not-found" });
  });

  it("reads the token of a password reset link", () => {
    expect(parseRoute("#/passwort/Zz09_-")).toEqual({ name: "password-reset", token: "Zz09_-" });
  });

  it.each([
    "#/einladung",
    "#/einladung/",
    "#/einladung/abc/def",
    "#/einladung/ab+c",
    "#/einladung/ab=",
    "#/einladung/ab%20c",
    "#/einladung/ab c",
    "#/einladung/ä",
    "#/passwort",
    "#/passwort/a.b",
    "#/passwort/a/b",
    "#/passwort/../etc",
    `#/passwort/${"a".repeat(513)}`,
  ])("maps the bad token link %j to not-found", (hash) => {
    expect(parseRoute(hash)).toEqual({ name: "not-found" });
  });

  it.each(["#/gibt-es-nicht", "#/start/extra", "#nonsense", "#/profil/extra", "#/kalender/extra", "#/calendars", "#/token/abc"])(
    "maps %j to not-found",
    (hash) => {
      expect(parseRoute(hash)).toEqual({ name: "not-found" });
    },
  );
});

interface Entry {
  hash: string;
  state: unknown;
}

/** A small fake browser window: a history list, hash changes that push entries, replace(), go(). */
function fakeWindow(startHash: string, startState: unknown = null) {
  const entries: Entry[] = [{ hash: startHash, state: startState }];
  let index = 0;
  const listeners = new Set<() => void>();
  const fire = (): void => [...listeners].forEach((listener) => listener());
  const win = {
    location: {
      get hash() {
        return entries[index]!.hash;
      },
      set hash(value: string) {
        const next = value === "" || value.startsWith("#") ? value : `#${value}`;
        if (next === entries[index]!.hash) return;
        entries.splice(index + 1);
        entries.push({ hash: next, state: null });
        index++;
        fire();
      },
      get href() {
        return `https://example.test/app${entries[index]!.hash}`;
      },
      replace(url: string) {
        const at = url.indexOf("#");
        const next = at === -1 ? "" : url.slice(at);
        const changed = next !== entries[index]!.hash;
        entries[index] = { hash: next, state: null };
        if (changed) fire();
      },
    },
    history: {
      get state() {
        return entries[index]!.state;
      },
      replaceState(state: unknown) {
        entries[index]!.state = state;
      },
      go(n: number) {
        const target = index + n;
        if (target < 0 || target >= entries.length) return;
        index = target;
        fire();
      },
    },
    addEventListener(_type: string, listener: () => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: string, listener: () => void) {
      listeners.delete(listener);
    },
  };
  return { win: win as unknown as Window, entries, index: () => index };
}

describe("history and goToStart", () => {
  it("steps back over every page and then Back leaves the app (Start, A, B)", () => {
    const f = fakeWindow("#/");
    const seen: Route[] = [];
    watchRoute((r) => seen.push(r), f.win);
    navigate("#/profil", {}, f.win);
    navigate("#/kalender", {}, f.win);
    expect(f.entries.length).toBe(3);
    goToStart(f.win);
    expect(f.index()).toBe(0);
    expect(seen.at(-1)).toEqual({ name: "start" });
    // Index 0 is the first entry of the app: another Back would leave it.
    goToStart(f.win);
    expect(f.index()).toBe(0);
  });

  it("measures from the start page again after a new push (Start, A, back to start, C)", () => {
    const f = fakeWindow("#/");
    watchRoute(() => {}, f.win);
    navigate("#/profil", {}, f.win);
    goToStart(f.win);
    expect(f.index()).toBe(0);
    navigate("#/suche", {}, f.win);
    expect(f.entries.length).toBe(2);
    expect(f.win.history.state).toEqual({ toStart: 1 });
    goToStart(f.win);
    expect(f.index()).toBe(0);
  });

  it("replaces the entry with the start page when the app was opened on a sub page", () => {
    const f = fakeWindow("#/profil");
    const seen: Route[] = [];
    watchRoute((r) => seen.push(r), f.win);
    goToStart(f.win);
    expect(f.entries.length).toBe(1);
    expect(f.entries[0]!.hash).toBe("#/");
    expect(f.entries[0]!.state).toEqual({ toStart: 0 });
    expect(seen.at(-1)).toEqual({ name: "start" });
  });

  it("does nothing on the start page", () => {
    const f = fakeWindow("#/");
    watchRoute(() => {}, f.win);
    goToStart(f.win);
    expect(f.entries.length).toBe(1);
    expect(f.index()).toBe(0);
  });

  it("keeps the distance when a redirect replaces an entry (Start, A, replace B)", () => {
    const f = fakeWindow("#/");
    watchRoute(() => {}, f.win);
    navigate("#/abstimmung-neu", {}, f.win);
    navigate("#/abstimmung/abc", { replace: true }, f.win);
    expect(f.entries.map((e) => e.hash)).toEqual(["#/", "#/abstimmung/abc"]);
    expect(f.win.history.state).toEqual({ toStart: 1 });
    goToStart(f.win);
    expect(f.index()).toBe(0);
  });

  it("forgets the distance when the start entry itself is replaced by another page", () => {
    const f = fakeWindow("#/");
    watchRoute(() => {}, f.win);
    navigate("#/profil", { replace: true }, f.win);
    expect(f.entries.length).toBe(1);
    expect(f.win.history.state).toEqual({ toStart: null });
  });

  it("keeps the stored value after a reload and merges other state keys", () => {
    const f = fakeWindow("#/kalender", { toStart: 2, other: 1 });
    watchRoute(() => {}, f.win);
    expect(f.win.history.state).toEqual({ toStart: 2, other: 1 });
    const g = fakeWindow("#/kalender", { other: 1 });
    watchRoute(() => {}, g.win);
    expect(g.win.history.state).toEqual({ other: 1, toStart: null });
  });

  it("does not add an entry when the same hash is set again", () => {
    const f = fakeWindow("#/");
    watchRoute(() => {}, f.win);
    navigate("#/profil", {}, f.win);
    navigate("#/profil", {}, f.win);
    expect(f.entries.length).toBe(2);
    navigate("#/profil", { replace: true }, f.win);
    expect(f.entries.length).toBe(2);
  });
});

describe("watchRoute fresh flag", () => {
  it("marks only newly opened pages as fresh, not the first call or Back/Forward", () => {
    const f = fakeWindow("#/");
    const fresh: boolean[] = [];
    watchRoute((_r, change) => fresh.push(change.fresh), f.win);
    navigate("#/kalender", {}, f.win);
    navigate("#/privatsphaere", {}, f.win);
    f.win.history.go(-1);
    f.win.history.go(1);
    expect(fresh).toEqual([false, true, true, false, false]);
  });
});
