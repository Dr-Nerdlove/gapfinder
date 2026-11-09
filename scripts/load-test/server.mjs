// The real API server (the built `server/dist`, as in the Docker image) for the load test. One difference: calendar
// links `https://cal.loadtest/...` are fetched through the real `fetch.ts`, but from the local calendar host
// (plain HTTP on 127.0.0.1) instead of the internet. A second port answers `/stats` with what was measured inside
// the process since the last `/stats?reset=1`: highest memory and the event loop's delays (how long other requests
// had to wait). Never use it for anything but the load test.
import http from "node:http";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { buildApp } from "../../server/dist/app.js";
import { fetchCalendarText } from "../../server/dist/calendars/fetch.js";
import { loadConfig } from "../../server/dist/config.js";

const hostPort = Number(process.env.LOAD_CALENDAR_PORT ?? 8090);
const statsPort = Number(process.env.LOAD_STATS_PORT ?? 8091);

const MB = 1024 * 1024;
let peak = { rss: 0, heapUsed: 0, external: 0 };
const sample = () => {
  const m = process.memoryUsage();
  peak = { rss: Math.max(peak.rss, m.rss), heapUsed: Math.max(peak.heapUsed, m.heapUsed), external: Math.max(peak.external, m.external + m.arrayBuffers) };
};
setInterval(sample, 20).unref();
const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();

const config = loadConfig();
const app = await buildApp(config, {
  fetchCalendarText: (url) =>
    fetchCalendarText(url, {
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      isAllowedAddress: () => true,
      transport: { request: http.request, port: hostPort },
    }),
});
await app.listen({ port: config.port, host: config.host });

http
  .createServer((req, res) => {
    sample();
    const body = {
      rssMB: +(peak.rss / MB).toFixed(1),
      heapUsedMB: +(peak.heapUsed / MB).toFixed(1),
      externalMB: +(peak.external / MB).toFixed(1),
      nowRssMB: +(process.memoryUsage().rss / MB).toFixed(1),
      loopMaxMs: +(loop.max / 1e6).toFixed(0),
      loopP99Ms: +(loop.percentile(99) / 1e6).toFixed(0),
    };
    if (req.url?.includes("reset=1")) {
      // Let the garbage collector clean up first when it is exposed (`--expose-gc`), so phases do not inherit garbage.
      globalThis.gc?.();
      peak = { rss: 0, heapUsed: 0, external: 0 };
      sample();
      loop.reset();
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
  })
  .listen(statsPort, "127.0.0.1");
console.log("load-test server listening");
