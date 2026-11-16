import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, parseCinemas } from "../src/config.js";
import { parseShowings } from "../src/cinemas/cineamo.js";
import { buildApp } from "../src/app.js";
import type { FetchResult } from "../src/calendars/fetch.js";
import { addUserWithSession, call, createTestEnv, testConfig, type TestEnv } from "./helpers.js";

const CINEMAS = [
  { id: 12, name: "Kino Eins" },
  { id: 345, name: "Café Lichtspiele" },
];

describe("CINEMAS config", () => {
  it("is empty and not a problem for the app when not set", () => {
    expect(loadConfig({}).cinemas).toEqual([]);
    expect(loadConfig({}).cinemasProblem).toBe("CINEMAS is not set");
    expect(loadConfig({ CINEMAS: "  " }).cinemas).toEqual([]);
  });

  it("reads ids and names, trimmed, with umlauts and spaces", () => {
    const config = loadConfig({ CINEMAS: " 12 = Kino Eins ; 345=Café Lichtspiele;" });
    expect(config.cinemas).toEqual(CINEMAS);
    expect(config.cinemasProblem).toBeNull();
  });

  const secret = "SECRET-NAME";
  it.each([
    ["no equals sign", `12 ${secret}`],
    ["id is not a number", `abc=${secret}`],
    ["id is zero", `0=${secret}`],
    ["id has ten digits", `1234567890=${secret}`],
    ["id is negative", `-5=${secret}`],
    ["empty name", "12=   "],
    ["name too long", `12=${"x".repeat(101)}${secret}`],
    ["duplicate id", `12=${secret};12=Other`],
    ["one broken entry among good ones", `12=${secret};abc=Other`],
    ["only separators", ";;"],
    ["more than 20 cinemas", Array.from({ length: 21 }, (_, i) => `${i + 1}=${secret}`).join(";")],
  ])("never throws and gives no cinemas for a bad value: %s", (_why, value) => {
    const config = loadConfig({ CINEMAS: value });
    expect(config.cinemas).toEqual([]);
    expect(config.cinemasProblem).toMatch(/^CINEMAS is not valid: /);
    expect(config.cinemasProblem).not.toContain(secret);
    expect(config.cinemasProblem).not.toContain(value);
  });

  it("accepts exactly 20 cinemas and a name of exactly 100 characters", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `${i + 1}=Kino ${i}`).join(";");
    expect(parseCinemas(twenty).cinemas).toHaveLength(20);
    expect(parseCinemas(`7=${"y".repeat(100)}`).problem).toBeNull();
  });
});

const REAL_SHAPE = JSON.stringify({
  _embedded: {
    showings: [
      {
        id: 3,
        name: "Zweiter Film",
        startDatetime: "2026-11-17T18:30:00Z",
        endDatetime: null,
        state: "scheduled",
        language: null,
        onlineTicketUrl: "https://tickets.example/checkout/381/ABC",
        cinemaId: 1,
        _embedded: { content: {}, cinema: {} },
      },
      {
        id: 1,
        name: "  Erster Film  ",
        startDatetime: "2026-11-17T14:00:00Z",
        state: "scheduled",
        language: "deu",
        onlineTicketUrl: "https://tickets.example/a",
      },
      { id: 4, name: "Unsicherer Link", startDatetime: "2026-11-17T20:00:00Z", language: "ENG", onlineTicketUrl: "http://tickets.example/a" },
      { id: 5, name: "Mit Passwort", startDatetime: "2026-11-17T20:15:00Z", onlineTicketUrl: "https://user:pw@tickets.example/a" },
      { id: 6, name: "Abgesagt", startDatetime: "2026-11-17T21:00:00Z", state: "cancelled" },
      { id: 7, name: "Kaputtes Datum", startDatetime: "gestern" },
      { id: 8, name: "   ", startDatetime: "2026-11-17T22:00:00Z" },
      { id: 9, startDatetime: "2026-11-17T22:00:00Z" },
      { id: 10, name: "Ohne Start" },
      "not an object",
    ],
  },
  _page: 1,
  _page_count: 1,
  _total_items: 10,
});

describe("parseShowings", () => {
  it("keeps the good entries, sorted, and drops or empties what is unsafe", () => {
    expect(parseShowings(REAL_SHAPE)).toEqual([
      { film: "Erster Film", start: "2026-11-17T14:00:00.000Z", language: "deu", ticketUrl: "https://tickets.example/a" },
      { film: "Zweiter Film", start: "2026-11-17T18:30:00.000Z", ticketUrl: "https://tickets.example/checkout/381/ABC" },
      { film: "Unsicherer Link", start: "2026-11-17T20:00:00.000Z" },
      { film: "Mit Passwort", start: "2026-11-17T20:15:00.000Z" },
    ]);
  });

  it("sorts equal starts by film and cuts long names", () => {
    const text = JSON.stringify({
      _embedded: {
        showings: [
          { name: "B", startDatetime: "2026-11-17T14:00:00Z" },
          { name: "A".repeat(250), startDatetime: "2026-11-17T14:00:00Z" },
        ],
      },
    });
    const result = parseShowings(text)!;
    expect(result[0]!.film).toHaveLength(200);
    expect(result[1]!.film).toBe("B");
  });

  it("drops a ticket address longer than 500 characters", () => {
    const text = JSON.stringify({
      _embedded: {
        showings: [{ name: "A", startDatetime: "2026-11-17T14:00:00Z", onlineTicketUrl: `https://t.example/${"x".repeat(500)}` }],
      },
    });
    expect(parseShowings(text)).toEqual([{ film: "A", start: "2026-11-17T14:00:00.000Z" }]);
  });

  it.each(["", "<html>", "[]", "null", '{"_embedded":{}}', '{"_embedded":{"showings":"x"}}'])(
    "returns null for %j",
    (text) => {
      expect(parseShowings(text)).toBeNull();
    },
  );

  it("accepts an empty list", () => {
    expect(parseShowings('{"_embedded":{"showings":[]}}')).toEqual([]);
  });
});

describe("admin cinema routes", () => {
  let env: TestEnv;
  let urls: string[];
  let reply: () => FetchResult;
  afterEach(async () => {
    await env.app.close();
  });

  async function setup(overrides: Parameters<typeof createTestEnv>[0] = { cinemas: CINEMAS, cinemasProblem: null }) {
    urls = [];
    reply = () => ({ ok: true, text: REAL_SHAPE });
    env = await createTestEnv(overrides, {
      fetchCinemaText: async (url) => {
        urls.push(url.href);
        return reply();
      },
    });
    const admin = await addUserWithSession(env, "Admin", { isAdmin: true });
    const user = await addUserWithSession(env, "Normal");
    return { admin: admin.token, user: user.token };
  }

  // The test clock starts on 2026-11-01 10:00 UTC (11:00 in Berlin).
  const DAY = "2026-11-02";

  it("refuses normal users and visitors", async () => {
    const { user } = await setup();
    for (const url of ["/api/admin/cinemas", `/api/admin/cinemas/12/showings?date=${DAY}`]) {
      expect((await call(env, "GET", url, { token: user })).statusCode).toBe(403);
      expect((await call(env, "GET", url)).statusCode).toBe(401);
    }
    expect(urls).toEqual([]);
  });

  it("lists the configured cinemas for an admin", async () => {
    const { admin } = await setup();
    const response = await call(env, "GET", "/api/admin/cinemas", { token: admin });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ cinemas: CINEMAS });
  });

  it("answers 404 for a cinema that is not configured and never asks cineamo", async () => {
    const { admin } = await setup();
    for (const id of ["999", "1", "12abc", "012", "1e1"]) {
      const response = await call(env, "GET", `/api/admin/cinemas/${id}/showings?date=${DAY}`, { token: admin });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: "not_found" });
    }
    expect(urls).toEqual([]);
  });

  it.each([
    ["missing", ""],
    ["not a date", "?date=morgen"],
    ["not a real day", "?date=2026-02-30"],
    ["with a time", "?date=2026-11-02T10:00"],
    ["two days ago", "?date=2026-10-30"],
    ["22 days ahead", "?date=2026-11-23"],
  ])("answers 400 for a bad date: %s", async (_why, query) => {
    const { admin } = await setup();
    const response = await call(env, "GET", `/api/admin/cinemas/12/showings${query}`, { token: admin });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "validation", field: "date" });
    expect(urls).toEqual([]);
  });

  it("accepts yesterday and 21 days ahead", async () => {
    const { admin } = await setup();
    for (const date of ["2026-10-31", "2026-11-22"]) {
      const response = await call(env, "GET", `/api/admin/cinemas/12/showings?date=${date}`, { token: admin });
      expect(response.statusCode).toBe(200);
    }
  });

  it("returns the showings and asks cineamo for the configured id only", async () => {
    const { admin } = await setup();
    const response = await call(env, "GET", `/api/admin/cinemas/345/showings?date=${DAY}`, { token: admin });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ showings: unknown[] }>().showings).toHaveLength(4);
    expect(urls).toEqual([`https://api.cineamo.com/showings?cinemaId=345&date=${DAY}&per_page=100`]);
  });

  it("serves a second call from the cache, and asks again after 6 hours", async () => {
    const { admin } = await setup();
    const url = `/api/admin/cinemas/12/showings?date=${DAY}`;
    await call(env, "GET", url, { token: admin });
    await call(env, "GET", url, { token: admin });
    expect(urls).toHaveLength(1);
    await call(env, "GET", `/api/admin/cinemas/12/showings?date=2026-11-03`, { token: admin });
    expect(urls).toHaveLength(2);
    env.clock.advanceHours(5);
    await call(env, "GET", url, { token: admin });
    expect(urls).toHaveLength(2);
    env.clock.advanceHours(2);
    await call(env, "GET", url, { token: admin });
    expect(urls).toHaveLength(3);
  });

  it("shares one fetch between simultaneous requests", async () => {
    const { admin } = await setup();
    const url = `/api/admin/cinemas/12/showings?date=${DAY}`;
    const answers = await Promise.all([1, 2, 3].map(() => call(env, "GET", url, { token: admin })));
    expect(answers.map((a) => a.statusCode)).toEqual([200, 200, 200]);
    expect(urls).toHaveLength(1);
  });

  it("answers 502 cinema_unavailable on a failure, keeps it 5 minutes, and the server stays healthy", async () => {
    const { admin } = await setup();
    reply = () => ({ ok: false, reason: "unreachable" });
    const url = `/api/admin/cinemas/12/showings?date=${DAY}`;
    const first = await call(env, "GET", url, { token: admin });
    expect(first.statusCode).toBe(502);
    expect(first.json()).toMatchObject({ code: "cinema_unavailable" });
    await call(env, "GET", url, { token: admin });
    expect(urls).toHaveLength(1);
    expect((await call(env, "GET", "/api/health")).json()).toMatchObject({ status: "ok" });
    env.clock.advanceMinutes(6);
    reply = () => ({ ok: true, text: REAL_SHAPE });
    expect((await call(env, "GET", url, { token: admin })).statusCode).toBe(200);
    expect(urls).toHaveLength(2);
  });

  it("answers 502 when cineamo's answer is not the expected JSON, and when the fetch throws", async () => {
    const { admin } = await setup();
    reply = () => ({ ok: true, text: "<html>maintenance</html>" });
    const url = `/api/admin/cinemas/12/showings?date=${DAY}`;
    expect((await call(env, "GET", url, { token: admin })).statusCode).toBe(502);
    reply = () => {
      throw new Error("boom");
    };
    const other = `/api/admin/cinemas/12/showings?date=2026-11-04`;
    const response = await call(env, "GET", other, { token: admin });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ code: "cinema_unavailable" });
  });
});

describe("GET /api/health feature cinema_showtimes", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });
  const features = async (overrides: Parameters<typeof testConfig>[0]) => {
    app = await buildApp(testConfig(overrides));
    return (await app.inject({ method: "GET", url: "/api/health" })).json<{ features: string[] }>().features;
  };

  it("is listed only when cinemas are configured", async () => {
    expect(await features({})).not.toContain("cinema_showtimes");
    await app?.close();
    expect(await features({ cinemas: CINEMAS, cinemasProblem: null })).toContain("cinema_showtimes");
  });
});
