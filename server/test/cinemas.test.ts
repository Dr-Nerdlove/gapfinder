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

  it("reads an optional preferred screen after a bar", () => {
    const config = loadConfig({ CINEMAS: "12=Kino Eins|IMAX; 345 = Café Lichtspiele | Saal 2 ;7=Kino Drei" });
    expect(config.cinemas).toEqual([
      { id: 12, name: "Kino Eins", room: "IMAX" },
      { id: 345, name: "Café Lichtspiele", room: "Saal 2" },
      { id: 7, name: "Kino Drei" },
    ]);
    expect(config.cinemasProblem).toBeNull();
  });

  it.each([
    ["empty screen", `12=Kino|`],
    ["blank screen", `12=Kino|   `],
    ["second bar", `12=Kino|A|${secret}`],
    ["screen too long", `12=Kino|${"x".repeat(61)}${secret}`],
    ["empty name before the bar", `12=|${secret}`],
  ])("gives no cinemas for a bad screen: %s", (_why, value) => {
    const config = loadConfig({ CINEMAS: value });
    expect(config.cinemas).toEqual([]);
    expect(config.cinemasProblem).toMatch(/^CINEMAS is not valid: /);
    expect(config.cinemasProblem).not.toContain(secret);
    expect(config.cinemasProblem).not.toContain(value);
  });

  it("accepts a screen of exactly 60 characters", () => {
    expect(parseCinemas(`7=Kino|${"z".repeat(60)}`).problem).toBeNull();
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

const showingEntry = (id: number, name: string, start: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  startDatetime: start,
  state: "scheduled",
  ...extra,
});
const page = (showings: unknown[], pageNumber = 1, pageCount = 1) =>
  JSON.stringify({ _embedded: { showings }, _page: pageNumber, _page_count: pageCount });
const roomsAnswer = (rooms: unknown[], pageCount = 1) =>
  JSON.stringify({ _total_items: rooms.length, _page: 1, _page_count: pageCount, _embedded: { cinemaRooms: rooms } });

describe("parseShowings screens", () => {
  it("marks IMAX only when isImax is true", () => {
    const text = page([
      showingEntry(1, "A", "2026-11-17T14:00:00Z", { isImax: true }),
      showingEntry(2, "B", "2026-11-17T15:00:00Z", { isImax: null }),
      showingEntry(3, "C", "2026-11-17T16:00:00Z", { isImax: "true" }),
    ]);
    expect(parseShowings(text)!.map((s) => s.imax)).toEqual([true, undefined, undefined]);
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

describe("admin cinema routes: pages and screens", () => {
  let env: TestEnv;
  let urls: string[];
  let admin: string;
  let answer: (url: URL) => FetchResult;
  afterEach(async () => {
    await env.app.close();
  });

  const DAY = "2026-11-02";
  const showingsUrl = (cinema: number, date = DAY) => `/api/admin/cinemas/${cinema}/showings?date=${date}`;
  const isRooms = (url: URL) => url.pathname === "/cinema-rooms";
  const roomCalls = () => urls.filter((u) => u.includes("/cinema-rooms"));
  const showingCalls = () => urls.filter((u) => u.includes("/showings"));

  async function setup(): Promise<void> {
    urls = [];
    answer = () => ({ ok: true, text: page([]) });
    env = await createTestEnv(
      { cinemas: CINEMAS, cinemasProblem: null },
      {
        fetchCinemaText: async (url) => {
          urls.push(url.href);
          return answer(url);
        },
      },
    );
    admin = (await addUserWithSession(env, "Admin", { isAdmin: true })).token;
  }

  const get = async (cinema = 12, date = DAY) => call(env, "GET", showingsUrl(cinema, date), { token: admin });
  const films = (response: { json: <T>() => T }) => response.json<{ showings: { film: string; room?: string; imax?: true }[] }>().showings;

  it("joins two pages, sorted, asks for page 2 explicitly, and caches the whole round", async () => {
    await setup();
    answer = (url) =>
      url.searchParams.get("page") === "2"
        ? { ok: true, text: page([showingEntry(2, "Früh", "2026-11-02T08:00:00Z")], 2, 2) }
        : { ok: true, text: page([showingEntry(1, "Spät", "2026-11-02T20:00:00Z")], 1, 2) };
    const response = await get();
    expect(response.statusCode).toBe(200);
    expect(films(response).map((s) => s.film)).toEqual(["Früh", "Spät"]);
    expect(urls).toEqual([
      `https://api.cineamo.com/showings?cinemaId=12&date=${DAY}&per_page=100`,
      `https://api.cineamo.com/showings?cinemaId=12&date=${DAY}&per_page=100&page=2`,
    ]);
    await get();
    expect(urls).toHaveLength(2);
  });

  it("fails the whole fetch when a later page fails, and keeps the failure for 5 minutes", async () => {
    await setup();
    answer = (url) =>
      url.searchParams.get("page") === "2"
        ? { ok: false, reason: "unreachable" }
        : { ok: true, text: page([showingEntry(1, "A", "2026-11-02T20:00:00Z")], 1, 2) };
    const response = await get();
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ code: "cinema_unavailable" });
    await get();
    expect(urls).toHaveLength(2);
  });

  it("fails the whole fetch when a later page cannot be read", async () => {
    await setup();
    answer = (url) =>
      url.searchParams.get("page") === "2"
        ? { ok: true, text: "<html>" }
        : { ok: true, text: page([showingEntry(1, "A", "2026-11-02T20:00:00Z")], 1, 2) };
    expect((await get()).statusCode).toBe(502);
  });

  it("reads at most 5 pages", async () => {
    await setup();
    answer = (url) => {
      const n = Number(url.searchParams.get("page") ?? "1");
      return { ok: true, text: page([showingEntry(n, `Film ${n}`, `2026-11-02T1${n}:00:00Z`)], n, 9) };
    };
    const response = await get();
    expect(response.statusCode).toBe(200);
    expect(films(response)).toHaveLength(5);
    expect(urls).toHaveLength(5);
  });

  it("attaches the screen's name and IMAX, fetches the screens with perPage=50, and shows what has no screen as it is", async () => {
    await setup();
    answer = (url) =>
      isRooms(url)
        ? { ok: true, text: roomsAnswer([{ id: 134, name: "  Saal Eins  ", cinemaId: 12 }, { id: 5, name: "Kino 2" }]) }
        : {
            ok: true,
            text: page([
              showingEntry(1, "A", "2026-11-02T18:00:00Z", { cinemaRoomId: 134, isImax: true }),
              showingEntry(2, "B", "2026-11-02T19:00:00Z", { cinemaRoomId: 5 }),
              showingEntry(3, "C", "2026-11-02T20:00:00Z", { cinemaRoomId: null }),
              showingEntry(4, "D", "2026-11-02T21:00:00Z", { cinemaRoomId: 999 }),
            ]),
          };
    const response = await get();
    expect(response.statusCode).toBe(200);
    expect(response.json<{ showings: unknown[] }>().showings).toEqual([
      { film: "A", start: "2026-11-02T18:00:00.000Z", imax: true, room: "Saal Eins" },
      { film: "B", start: "2026-11-02T19:00:00.000Z", room: "Kino 2" },
      { film: "C", start: "2026-11-02T20:00:00.000Z" },
      { film: "D", start: "2026-11-02T21:00:00.000Z" },
    ]);
    expect(roomCalls()).toEqual(["https://api.cineamo.com/cinema-rooms?cinemaId=12&perPage=50"]);
  });

  it("cuts a long screen name to 60 characters", async () => {
    await setup();
    answer = (url) =>
      isRooms(url)
        ? { ok: true, text: roomsAnswer([{ id: 1, name: "x".repeat(80) }]) }
        : { ok: true, text: page([showingEntry(1, "A", "2026-11-02T18:00:00Z", { cinemaRoomId: 1 })]) };
    expect(films(await get())[0]!.room).toHaveLength(60);
  });

  it("reads further pages of the screens (at most 3)", async () => {
    await setup();
    answer = (url) => {
      if (!isRooms(url)) return { ok: true, text: page([showingEntry(1, "A", "2026-11-02T18:00:00Z", { cinemaRoomId: 3 })]) };
      const n = Number(url.searchParams.get("page") ?? "1");
      return { ok: true, text: roomsAnswer([{ id: n, name: `Saal ${n}` }], 9) };
    };
    const response = await get();
    expect(films(response)[0]!.room).toBe("Saal 3");
    expect(roomCalls()).toHaveLength(3);
  });

  it("still returns the showings, without screens, when the screens cannot be fetched or read", async () => {
    await setup();
    let roomsReply: FetchResult = { ok: false, reason: "unreachable" };
    answer = (url) =>
      isRooms(url) ? roomsReply : { ok: true, text: page([showingEntry(1, "A", "2026-11-02T18:00:00Z", { cinemaRoomId: 3 })]) };
    const first = await get();
    expect(first.statusCode).toBe(200);
    expect(films(first)).toEqual([{ film: "A", start: "2026-11-02T18:00:00.000Z" }]);
    // Failure is kept for 5 minutes, then the screens are asked again and appear.
    await get();
    expect(roomCalls()).toHaveLength(1);
    env.clock.advanceMinutes(6);
    roomsReply = { ok: true, text: roomsAnswer([{ id: 3, name: "Saal 3" }]) };
    expect(films(await get())[0]!.room).toBe("Saal 3");
    roomsReply = { ok: true, text: "not json" };
    env.clock.advanceHours(25);
    const unreadable = await get();
    expect(unreadable.statusCode).toBe(200);
    expect(films(unreadable)[0]!.room).toBeUndefined();
  });

  it("fetches the screens once for several days of the same cinema, and again after 24 hours", async () => {
    await setup();
    answer = (url) =>
      isRooms(url)
        ? { ok: true, text: roomsAnswer([{ id: 3, name: "Saal 3" }]) }
        : { ok: true, text: page([showingEntry(1, "A", "2026-11-02T18:00:00Z", { cinemaRoomId: 3 })]) };
    await get(12, "2026-11-02");
    await get(12, "2026-11-03");
    expect(roomCalls()).toHaveLength(1);
    await get(345, "2026-11-02");
    expect(roomCalls()).toHaveLength(2);
    env.clock.advanceHours(23);
    await get(12, "2026-11-04");
    expect(roomCalls()).toHaveLength(2);
    env.clock.advanceHours(2);
    await get(12, "2026-11-05");
    expect(roomCalls()).toHaveLength(3);
  });

  it("does not ask for the screens when no showing has a screen id", async () => {
    await setup();
    answer = () => ({ ok: true, text: page([showingEntry(1, "A", "2026-11-02T18:00:00Z", { cinemaRoomId: null, isImax: true })]) });
    const response = await get();
    expect(films(response)).toEqual([{ film: "A", start: "2026-11-02T18:00:00.000Z", imax: true }]);
    expect(roomCalls()).toEqual([]);
    expect(showingCalls()).toHaveLength(1);
  });
});

describe("CINEMAS config: screen page", () => {
  const PAGE = "https://www.kino.example/programm/saal-eins/";
  it("reads the address after the first @ of the screen part", () => {
    const config = loadConfig({
      CINEMAS: `345=Kino Zwei|Saal Eins@${PAGE}; 12=Kino Eins|IMAX`,
    });
    expect(config.cinemas).toEqual([
      { id: 345, name: "Kino Zwei", room: "Saal Eins", roomPage: PAGE },
      { id: 12, name: "Kino Eins", room: "IMAX" },
    ]);
    expect(config.cinemasProblem).toBeNull();
  });

  const secret = "SECRET-HOST";
  it.each([
    ["http address", `7=Kino|Saal@http://${secret}.example/a`],
    ["address with a port", `7=Kino|Saal@https://${secret}.example:8443/a`],
    ["address with credentials", `7=Kino|Saal@https://user:pw@${secret}.example/a`],
    ["private IP literal", `7=Kino|Saal@https://10.0.0.5/${secret}`],
    ["loopback literal", `7=Kino|Saal@https://127.0.0.1/${secret}`],
    ["address too long", `7=Kino|Saal@https://${secret}.example/${"x".repeat(300)}`],
    ["not an address", `7=Kino|Saal@${secret}`],
    ["empty address", `7=Kino|Saal@`],
    ["@ without a screen", `7=Kino|@https://${secret}.example/a`],
  ])("gives no cinemas and a problem without the value: %s", (_why, value) => {
    const config = loadConfig({ CINEMAS: value });
    expect(config.cinemas).toEqual([]);
    expect(config.cinemasProblem).toMatch(/^CINEMAS is not valid: /);
    expect(config.cinemasProblem).not.toContain(secret);
    expect(config.cinemasProblem).not.toContain(value);
  });

  it("accepts an address of exactly 300 characters", () => {
    const base = "https://www.kino.example/";
    expect(parseCinemas(`7=Kino|Saal@${base}${"x".repeat(300 - base.length)}`).problem).toBeNull();
  });
});

describe("admin cinema routes: screen page", () => {
  let env: TestEnv;
  let urls: string[];
  let admin: string;
  let pageReply: () => FetchResult;
  afterEach(async () => {
    await env.app.close();
  });

  const DAY = "2026-11-02";
  const PAGE = "https://www.kino.example/programm/saal-eins/";
  const WITH_PAGE = [{ id: 777, name: "Kino Zwei", room: "Saal Eins", roomPage: PAGE }];
  const ticket = (id: string, sep = "&") => `https://tickets.example/shop?cinema=1${sep}performance=${id}${sep}lang=de`;
  let showingsText: string;
  const pageCalls = () => urls.filter((u) => u.startsWith(PAGE));

  async function setup(): Promise<void> {
    urls = [];
    pageReply = () => ({ ok: true, text: "<html></html>" });
    showingsText = page([]);
    env = await createTestEnv(
      { cinemas: [...CINEMAS, ...WITH_PAGE], cinemasProblem: null },
      {
        fetchCinemaText: async (url) => {
          urls.push(url.href);
          return url.hostname === "www.kino.example" ? pageReply() : { ok: true, text: showingsText };
        },
      },
    );
    admin = (await addUserWithSession(env, "Admin", { isAdmin: true })).token;
  }
  const get = async (cinema = 777, date = DAY) =>
    call(env, "GET", `/api/admin/cinemas/${cinema}/showings?date=${date}`, {
      token: admin,
    });
  const rooms = (response: { json: <T>() => T }) =>
    Object.fromEntries(
      response.json<{ showings: { film: string; room?: string }[] }>().showings.map((s) => [s.film, s.room ?? null]),
    );
  const entries = () => [
    showingEntry(1, "Auf der Seite", "2026-11-02T14:00:00Z", {
      onlineTicketUrl: ticket("AAAA1111"),
    }),
    showingEntry(2, "Auch auf der Seite", "2026-11-02T16:00:00Z", {
      onlineTicketUrl: ticket("BBBB2222"),
    }),
    showingEntry(3, "Nicht auf der Seite", "2026-11-02T18:00:00Z", {
      onlineTicketUrl: ticket("CCCC3333"),
    }),
    showingEntry(4, "Ohne Link", "2026-11-02T20:00:00Z"),
  ];

  it("does not list the address", async () => {
    await setup();
    const response = await call(env, "GET", "/api/admin/cinemas", {
      token: admin,
    });
    expect(response.json()).toEqual({
      cinemas: [...CINEMAS, { id: 777, name: "Kino Zwei", room: "Saal Eins" }],
    });
    expect(response.body).not.toContain("kino.example");
  });

  it("gives the screen to showings whose performance id is on the page, whatever the spelling of &", async () => {
    await setup();
    showingsText = page(entries());
    pageReply = () => ({
      ok: true,
      text: `<a href="https://tickets.example/shop?cinema=1&amp;performance=AAAA1111&amp;lang=de">x</a>
             <a href='https://tickets.example/shop?cinema=1&performance=BBBB2222'>y</a>
             <a href="https://tickets.example/shop?performance=SHORT">z</a>`,
    });
    const response = await get();
    expect(response.statusCode).toBe(200);
    expect(rooms(response)).toEqual({
      "Auf der Seite": "Saal Eins",
      "Auch auf der Seite": "Saal Eins",
      "Nicht auf der Seite": null,
      "Ohne Link": null,
    });
    expect(pageCalls()).toEqual([PAGE]);
  });

  it("lets a screen that cineamo names win, and does not fetch the page when every showing has one", async () => {
    await setup();
    showingsText = page([
      showingEntry(1, "Mit Saal", "2026-11-02T14:00:00Z", {
        cinemaRoomId: 5,
        onlineTicketUrl: ticket("AAAA1111"),
      }),
    ]);
    await env.app.close();
    urls = [];
    env = await createTestEnv(
      { cinemas: WITH_PAGE, cinemasProblem: null },
      {
        fetchCinemaText: async (url) => {
          urls.push(url.href);
          if (url.hostname === "www.kino.example") return { ok: true, text: `?performance=AAAA1111` };
          if (url.pathname === "/cinema-rooms") return { ok: true, text: roomsAnswer([{ id: 5, name: "Kino 5" }]) };
          return { ok: true, text: showingsText };
        },
      },
    );
    admin = (await addUserWithSession(env, "Admin", { isAdmin: true })).token;
    expect(rooms(await get())).toEqual({ "Mit Saal": "Kino 5" });
    expect(pageCalls()).toEqual([]);
  });

  it("does not fetch the page for an empty answer, and keeps a cineamo screen next to matched showings", async () => {
    await setup();
    await get();
    expect(pageCalls()).toEqual([]);
    await env.app.close();
    urls = [];
    env = await createTestEnv(
      { cinemas: WITH_PAGE, cinemasProblem: null },
      {
        fetchCinemaText: async (url) => {
          urls.push(url.href);
          if (url.hostname === "www.kino.example")
            return {
              ok: true,
              text: `?performance=AAAA1111 &performance=BBBB2222`,
            };
          if (url.pathname === "/cinema-rooms") return { ok: true, text: roomsAnswer([{ id: 5, name: "Kino 5" }]) };
          return {
            ok: true,
            text: page([
              showingEntry(1, "Cineamo", "2026-11-02T14:00:00Z", {
                cinemaRoomId: 5,
                onlineTicketUrl: ticket("AAAA1111"),
              }),
              showingEntry(2, "Seite", "2026-11-02T16:00:00Z", {
                onlineTicketUrl: ticket("BBBB2222"),
              }),
            ]),
          };
        },
      },
    );
    admin = (await addUserWithSession(env, "Admin", { isAdmin: true })).token;
    expect(rooms(await get())).toEqual({
      Cineamo: "Kino 5",
      Seite: "Saal Eins",
    });
  });

  it("still answers 200 with the showings, without those screens, when the page cannot be fetched", async () => {
    await setup();
    showingsText = page(entries());
    pageReply = () => ({ ok: false, reason: "unreachable" });
    const response = await get();
    expect(response.statusCode).toBe(200);
    expect(Object.values(rooms(response))).toEqual([null, null, null, null]);
    pageReply = () => {
      throw new Error("boom");
    };
    env.clock.advanceMinutes(6);
    expect((await get()).statusCode).toBe(200);
  });

  it("reads the page once for two days of the same cinema, and again after 6 hours", async () => {
    await setup();
    showingsText = page(entries());
    pageReply = () => ({ ok: true, text: "?performance=AAAA1111" });
    await get(777, "2026-11-02");
    const second = await get(777, "2026-11-03");
    expect(rooms(second)["Auf der Seite"]).toBe("Saal Eins");
    expect(pageCalls()).toHaveLength(1);
    env.clock.advanceHours(7);
    await get(777, "2026-11-04");
    expect(pageCalls()).toHaveLength(2);
  });

  it("does not use a page for a cinema without one", async () => {
    await setup();
    showingsText = page(entries());
    expect(rooms(await get(12))["Auf der Seite"]).toBeNull();
    expect(pageCalls()).toEqual([]);
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
