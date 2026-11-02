import { describe, expect, it } from "vitest";
import { feedScreenOf } from "./calendar-feed";

describe("the profile's calendar feed", () => {
  it("shows the link while the feed is on and the switch while it is off", () => {
    expect(feedScreenOf({ ok: true, data: { token: "abc" } })).toEqual({ phase: "on", token: "abc" });
    expect(feedScreenOf({ ok: true, data: { token: null } })).toEqual({ phase: "off" });
  });

  it("waits when the server sleeps", () => {
    expect(feedScreenOf({ ok: false, kind: "offline" })).toEqual({ phase: "waiting" });
  });

  it("says 'not there yet' for an older server that does not know the route", () => {
    expect(feedScreenOf({ ok: false, kind: "error", status: 404, code: "error" })).toEqual({ phase: "unavailable" });
  });

  it("shows other errors as text", () => {
    const screen = feedScreenOf({ ok: false, kind: "error", status: 500, code: "error" });
    expect(screen).toMatchObject({ phase: "failed" });
  });
});
