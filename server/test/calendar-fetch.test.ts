import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  fetchCalendarText,
  MAX_CALENDAR_BYTES,
  MAX_REDIRECTS,
  MAX_URL_LENGTH,
  normalizeCalendarUrl,
  type FetchOptions,
} from "../src/calendars/fetch.js";

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});

interface Seen {
  host: string | undefined;
  headers: http.IncomingHttpHeaders;
  url: string | undefined;
}

async function startServer(handler: http.RequestListener) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    seen.push({ host: req.headers.host, headers: req.headers, url: req.url });
    handler(req, res);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { seen, port: (server.address() as AddressInfo).port };
}

/** Options that send every request for any name to the local server; loopback counts as allowed. */
function toLocal(port: number, extra: FetchOptions = {}): FetchOptions {
  return {
    lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    isAllowedAddress: () => true,
    transport: { request: http.request, port },
    ...extra,
  };
}

const LINK = new URL("https://calendar.example/secret-token/basic.ics");

describe("normalizeCalendarUrl", () => {
  it("accepts an https link and keeps path and query", () => {
    expect(normalizeCalendarUrl("https://calendar.example/a/b.ics?x=1")?.href).toBe(
      "https://calendar.example/a/b.ics?x=1",
    );
  });

  it("trims spaces around the link", () => {
    expect(normalizeCalendarUrl("  https://calendar.example/a.ics \n")?.href).toBe("https://calendar.example/a.ics");
  });

  it.each(["webcal://calendar.example/a.ics", "WEBCAL://calendar.example/a.ics", "WebCal://calendar.example/a.ics"])(
    "turns %s into https",
    (input) => {
      expect(normalizeCalendarUrl(input)?.href).toBe("https://calendar.example/a.ics");
    },
  );

  it("takes port 443 away", () => {
    expect(normalizeCalendarUrl("https://calendar.example:443/a.ics")?.href).toBe("https://calendar.example/a.ics");
  });

  it("allows a public IP address as host", () => {
    expect(normalizeCalendarUrl("https://8.8.8.8/a.ics")).not.toBeNull();
    expect(normalizeCalendarUrl("https://[2a00:1450:4001:82b::200e]/a.ics")).not.toBeNull();
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   "],
    ["no link", "not a link"],
    ["http", "http://calendar.example/a.ics"],
    ["ftp", "ftp://calendar.example/a.ics"],
    ["file", "file:///etc/passwd"],
    ["javascript", "javascript:alert(1)"],
    ["no scheme", "calendar.example/a.ics"],
    ["no host", "https:///a.ics"],
    ["user name", "https://user@calendar.example/a.ics"],
    ["password", "https://user:secret@calendar.example/a.ics"],
    ["other port", "https://calendar.example:8443/a.ics"],
    ["port 80", "https://calendar.example:80/a.ics"],
    ["loopback", "https://127.0.0.1/a.ics"],
    ["loopback in hex form", "https://0x7f.0.0.1/a.ics"],
    ["loopback as number", "https://2130706433/a.ics"],
    ["private IPv4", "https://192.168.178.1/a.ics"],
    ["Tailscale address", "https://100.100.100.100/a.ics"],
    ["metadata address", "https://169.254.169.254/latest/meta-data"],
    ["IPv6 loopback", "https://[::1]/a.ics"],
    ["mapped IPv6", "https://[::ffff:10.0.0.5]/a.ics"],
    ["Tailscale IPv6", "https://[fd7a:115c:a1e0::1]/a.ics"],
    ["webcal to a private address", "webcal://10.0.0.5/a.ics"],
  ])("refuses %s", (_label, input) => {
    expect(normalizeCalendarUrl(input)).toBeNull();
  });

  it("refuses a link that is too long and accepts one of exactly the limit", () => {
    const prefix = "https://calendar.example/";
    expect(normalizeCalendarUrl(prefix + "a".repeat(MAX_URL_LENGTH - prefix.length))).not.toBeNull();
    expect(normalizeCalendarUrl(prefix + "a".repeat(MAX_URL_LENGTH - prefix.length + 1))).toBeNull();
  });
});

describe("fetchCalendarText", () => {
  it("returns the text of the calendar", async () => {
    const { port } = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/calendar" });
      res.end("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
    });
    expect(await fetchCalendarText(LINK, toLocal(port))).toEqual({
      ok: true,
      text: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
    });
  });

  it("sends the path, the query and the expected headers", async () => {
    const { port, seen } = await startServer((_req, res) => res.end("x"));
    await fetchCalendarText(new URL("https://calendar.example/a/b.ics?token=abc"), toLocal(port));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/a/b.ics?token=abc");
    expect(seen[0]!.headers["user-agent"]).toBe("Lueckenfueller/1.0 (calendar subscription)");
    expect(seen[0]!.headers.accept).toBe("text/calendar, */*;q=0.5");
    expect(seen[0]!.headers["accept-encoding"]).toBe("identity");
  });

  it("strips a byte order mark and decodes UTF-8", async () => {
    const { port } = await startServer((_req, res) => {
      res.end(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("SUMMARY:Lücke größer ß", "utf8")]));
    });
    expect(await fetchCalendarText(LINK, toLocal(port))).toEqual({ ok: true, text: "SUMMARY:Lücke größer ß" });
  });

  it("connects to the address from the lookup while the Host header keeps the name", async () => {
    const { port, seen } = await startServer((_req, res) => res.end("ok"));
    const asked: string[] = [];
    const result = await fetchCalendarText(
      LINK,
      toLocal(port, {
        lookup: async (host) => {
          asked.push(host);
          return [{ address: "127.0.0.1", family: 4 }];
        },
      }),
    );
    expect(result.ok).toBe(true);
    expect(asked).toEqual(["calendar.example"]);
    // "calendar.example" does not exist in DNS: only the pinned address can have been used.
    expect(seen[0]!.host).toBe(`calendar.example:${port}`);
  });

  it("connects to the first checked address", async () => {
    const { port } = await startServer((_req, res) => res.end("ok"));
    const result = await fetchCalendarText(
      LINK,
      toLocal(port, {
        lookup: async () => [
          { address: "127.0.0.1", family: 4 },
          { address: "203.0.113.50", family: 4 },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("refuses when one of several addresses is private, and does not connect", async () => {
    const { port, seen } = await startServer((_req, res) => res.end("ok"));
    const result = await fetchCalendarText(LINK, {
      lookup: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ],
      transport: { request: http.request, port },
    });
    expect(result).toEqual({ ok: false, reason: "blocked_address" });
    expect(seen).toHaveLength(0);
  });

  it("refuses a name that resolves to a private address with the default settings", async () => {
    const { port, seen } = await startServer((_req, res) => res.end("ok"));
    for (const address of ["10.0.0.5", "127.0.0.1", "100.100.100.100", "169.254.169.254"]) {
      const result = await fetchCalendarText(LINK, {
        lookup: async () => [{ address, family: 4 }],
        transport: { request: http.request, port },
      });
      expect(result).toEqual({ ok: false, reason: "blocked_address" });
    }
    const v6 = await fetchCalendarText(LINK, {
      lookup: async () => [{ address: "::1", family: 6 }],
      transport: { request: http.request, port },
    });
    expect(v6).toEqual({ ok: false, reason: "blocked_address" });
    const mapped = await fetchCalendarText(LINK, {
      lookup: async () => [{ address: "::ffff:10.0.0.5", family: 6 }],
      transport: { request: http.request, port },
    });
    expect(mapped).toEqual({ ok: false, reason: "blocked_address" });
    expect(seen).toHaveLength(0);
  });

  it("refuses an IP address as host with the default settings", async () => {
    expect(await fetchCalendarText(new URL("https://127.0.0.1/"))).toEqual({ ok: false, reason: "invalid_link" });
    expect(await fetchCalendarText(new URL("https://[::1]/"))).toEqual({ ok: false, reason: "invalid_link" });
  });

  it("refuses a link that is not valid", async () => {
    expect(await fetchCalendarText(new URL("http://calendar.example/a.ics"))).toEqual({
      ok: false,
      reason: "invalid_link",
    });
    expect(await fetchCalendarText(new URL("https://user:pw@calendar.example/a.ics"))).toEqual({
      ok: false,
      reason: "invalid_link",
    });
  });

  it("follows a redirect with a relative Location", async () => {
    const { port, seen } = await startServer((req, res) => {
      if (req.url === "/start.ics") {
        res.writeHead(302, { location: "/moved/real.ics?k=1" });
        res.end();
      } else {
        res.end("MOVED");
      }
    });
    const result = await fetchCalendarText(new URL("https://calendar.example/start.ics"), toLocal(port));
    expect(result).toEqual({ ok: true, text: "MOVED" });
    expect(seen.map((s) => s.url)).toEqual(["/start.ics", "/moved/real.ics?k=1"]);
  });

  it.each([301, 302, 303, 307, 308])("follows status %i", async (status) => {
    const { port } = await startServer((req, res) => {
      if (req.url === "/a") {
        res.writeHead(status, { location: "/b" });
        res.end();
      } else {
        res.end("B");
      }
    });
    expect(await fetchCalendarText(new URL("https://calendar.example/a"), toLocal(port))).toEqual({
      ok: true,
      text: "B",
    });
  });

  it("checks the address again after a redirect to another name", async () => {
    const { port, seen } = await startServer((req, res) => {
      if (req.url === "/start") {
        res.writeHead(302, { location: "https://evil.example/inside" });
        res.end();
      } else {
        res.end("SECRET");
      }
    });
    const result = await fetchCalendarText(new URL("https://calendar.example/start"), {
      lookup: async (host) =>
        host === "evil.example" ? [{ address: "10.0.0.5", family: 4 }] : [{ address: "127.0.0.1", family: 4 }],
      isAllowedAddress: (ip) => ip === "127.0.0.1", // loopback only stands in for "a public address" here
      transport: { request: http.request, port },
    });
    expect(result).toEqual({ ok: false, reason: "blocked_address" });
    expect(seen.map((s) => s.url)).toEqual(["/start"]);
  });

  it("refuses a redirect to an IP address of the home network", async () => {
    const { port } = await startServer((_req, res) => {
      res.writeHead(302, { location: "https://192.168.178.1/admin" });
      res.end();
    });
    const result = await fetchCalendarText(LINK, toLocal(port, { isAllowedAddress: (ip) => ip === "127.0.0.1" }));
    expect(result).toEqual({ ok: false, reason: "invalid_link" });
  });

  it("refuses a redirect to http", async () => {
    const { port } = await startServer((_req, res) => {
      res.writeHead(301, { location: "http://calendar.example/plain.ics" });
      res.end();
    });
    expect(await fetchCalendarText(LINK, toLocal(port))).toEqual({ ok: false, reason: "invalid_link" });
  });

  it("treats a redirect without Location as unreachable", async () => {
    const { port } = await startServer((_req, res) => {
      res.writeHead(302);
      res.end();
    });
    expect(await fetchCalendarText(LINK, toLocal(port))).toEqual({ ok: false, reason: "unreachable" });
  });

  function redirectChain(redirects: number) {
    return startServer((req, res) => {
      const step = Number(req.url!.slice(1));
      if (step < redirects) {
        res.writeHead(302, { location: `/${step + 1}` });
        res.end();
      } else {
        res.end("END");
      }
    });
  }

  it(`follows ${MAX_REDIRECTS} redirects`, async () => {
    const { port } = await redirectChain(MAX_REDIRECTS);
    expect(await fetchCalendarText(new URL("https://calendar.example/0"), toLocal(port))).toEqual({
      ok: true,
      text: "END",
    });
  });

  it(`gives up after more than ${MAX_REDIRECTS} redirects`, async () => {
    const { port } = await redirectChain(MAX_REDIRECTS + 1);
    expect(await fetchCalendarText(new URL("https://calendar.example/0"), toLocal(port))).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });

  it("gives up on a redirect loop", async () => {
    const { port, seen } = await startServer((_req, res) => {
      res.writeHead(302, { location: "/loop" });
      res.end();
    });
    const result = await fetchCalendarText(new URL("https://calendar.example/loop"), toLocal(port, { maxRedirects: 2 }));
    expect(result).toEqual({ ok: false, reason: "unreachable" });
    expect(seen).toHaveLength(3);
  });

  it("refuses a calendar whose Content-Length is too big", async () => {
    const { port } = await startServer((_req, res) => {
      res.writeHead(200, { "content-length": "5000" });
      res.end("x".repeat(5000));
    });
    expect(await fetchCalendarText(LINK, toLocal(port, { maxBytes: 1000 }))).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("refuses at once when the announced size is too big, without waiting for the body", async () => {
    const { port } = await startServer((_req, res) => {
      res.writeHead(200, { "content-length": "5000" });
      res.write("only a start"); // the rest never comes
    });
    const result = await fetchCalendarText(LINK, toLocal(port, { maxBytes: 1000, timeoutMs: 3000 }));
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("accepts a calendar of exactly the size limit", async () => {
    const { port } = await startServer((_req, res) => res.end("x".repeat(1000)));
    const result = await fetchCalendarText(LINK, toLocal(port, { maxBytes: 1000 }));
    expect(result).toEqual({ ok: true, text: "x".repeat(1000) });
  });

  it("stops a chunked stream that grows too big", async () => {
    let closed = false;
    const { port } = await startServer((_req, res) => {
      res.writeHead(200); // no Content-Length: chunked
      const timer = setInterval(() => res.write("x".repeat(600)), 5);
      res.on("close", () => {
        closed = true;
        clearInterval(timer);
      });
    });
    const result = await fetchCalendarText(LINK, toLocal(port, { maxBytes: 1000 }));
    expect(result).toEqual({ ok: false, reason: "too_large" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closed).toBe(true); // the download was cut off, not read to the end
  });

  it("has a default size limit of 10 MB", () => {
    expect(MAX_CALENDAR_BYTES).toBe(10 * 1024 * 1024);
  });

  it("gives up when the server never answers", async () => {
    const { port } = await startServer(() => {});
    const started = Date.now();
    const result = await fetchCalendarText(LINK, toLocal(port, { timeoutMs: 200 }));
    expect(result).toEqual({ ok: false, reason: "unreachable" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("applies the time limit to the whole fetch, not to each redirect", async () => {
    const { port } = await startServer((req, res) => {
      if (req.url === "/slow") return; // never answers
      setTimeout(() => {
        res.writeHead(302, { location: req.url === "/a" ? "/b" : "/slow" });
        res.end();
      }, 120);
    });
    const started = Date.now();
    const result = await fetchCalendarText(new URL("https://calendar.example/a"), toLocal(port, { timeoutMs: 300 }));
    expect(result).toEqual({ ok: false, reason: "unreachable" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("gives up when the DNS lookup hangs", async () => {
    const started = Date.now();
    const result = await fetchCalendarText(LINK, {
      lookup: () => new Promise(() => {}),
      timeoutMs: 200,
    });
    expect(result).toEqual({ ok: false, reason: "unreachable" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it.each([404, 410, 401, 403])("says gone for status %i", async (status) => {
    const { port } = await startServer((_req, res) => {
      res.writeHead(status);
      res.end("nope");
    });
    expect(await fetchCalendarText(LINK, toLocal(port))).toEqual({ ok: false, reason: "gone" });
  });

  it.each([500, 502, 503, 429, 204, 400])("says unreachable for status %i", async (status) => {
    const { port } = await startServer((_req, res) => {
      res.writeHead(status);
      res.end();
    });
    expect(await fetchCalendarText(LINK, toLocal(port))).toEqual({ ok: false, reason: "unreachable" });
  });

  it("says unreachable when the connection breaks in the middle of the answer", async () => {
    const { port } = await startServer((_req, res) => {
      res.writeHead(200, { "content-length": "100" });
      res.write("partial");
      setTimeout(() => res.destroy(), 20);
    });
    expect(await fetchCalendarText(LINK, toLocal(port))).toEqual({ ok: false, reason: "unreachable" });
  });

  it("says unreachable when nothing listens", async () => {
    const { port } = await startServer((_req, res) => res.end());
    const server = servers.pop()!;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await fetchCalendarText(LINK, toLocal(port))).toEqual({ ok: false, reason: "unreachable" });
  });

  it("says unreachable when the DNS lookup fails or finds nothing", async () => {
    const failing = await fetchCalendarText(LINK, {
      lookup: async () => {
        throw new Error("ENOTFOUND calendar.example");
      },
    });
    expect(failing).toEqual({ ok: false, reason: "unreachable" });
    const empty = await fetchCalendarText(LINK, { lookup: async () => [] });
    expect(empty).toEqual({ ok: false, reason: "unreachable" });
  });

  it("never leaks the link into the result", async () => {
    const secret = new URL("https://calendar.example/SECRET-TOKEN-123/basic.ics");
    const results = [
      await fetchCalendarText(secret, { lookup: async () => [{ address: "10.0.0.5", family: 4 }] }),
      await fetchCalendarText(secret, {
        lookup: async () => {
          throw new Error(`cannot resolve ${secret.href}`);
        },
      }),
    ];
    for (const result of results) expect(JSON.stringify(result)).not.toContain("SECRET-TOKEN");
  });
});
