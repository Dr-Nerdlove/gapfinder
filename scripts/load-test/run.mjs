// Load test of the API server (phase 9f, see README.md in this folder). Starts the calendar host and the real
// server, makes 50 accounts with about 130 calendars through the API, then measures searches with empty and
// filled calendar memory while other requests keep coming, and prints the results as a table.
//   node scripts/load-test/run.mjs [realistic|heavy]     (after `npm run build:shared && npm run build -w server`)
// Settings by environment: LOAD_DIR (default $TMPDIR/lueckenfueller-load), LOAD_HEAP_MB (default 512, see README).
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, createWriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const profile = process.argv[2] ?? "realistic";
const dir = process.env.LOAD_DIR ?? `${process.env.TMPDIR ?? "/tmp"}/lueckenfueller-load`;
const heapMB = process.env.LOAD_HEAP_MB ?? "512";
const API = "http://127.0.0.1:8080";
const STATS = "http://127.0.0.1:8091/stats";
const PASSWORD = "Test-Passwort-123";
const PEOPLE = 50;

rmSync(dir, { recursive: true, force: true });
mkdirSync(`${dir}/data`, { recursive: true });
const env = {
  ...process.env,
  DATA_DIR: `${dir}/data`,
  CALENDAR_KEY: randomBytes(32).toString("base64"),
  HOST: "127.0.0.1",
  PORT: "8080",
  CORS_ORIGIN: "http://localhost:5173",
  APP_URL: "http://localhost:5173/",
  LOG_LEVEL: "warn",
};

const children = [];
process.on("exit", () => children.forEach((c) => c.kill("SIGTERM")));
function start(name, args) {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  const log = createWriteStream(`${dir}/${name}.log`, { flags: "a" });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  children.push(child);
  return child;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`not reachable: ${url} (see ${dir}/*.log)`);
}

let server = null;
async function startServer() {
  if (server) {
    const exited = new Promise((r) => server.once("exit", r));
    server.kill("SIGTERM");
    await exited;
    children.splice(children.indexOf(server), 1);
  }
  server = start("server", [`--max-old-space-size=${heapMB}`, "--expose-gc", `${here}/server.mjs`]);
  await waitFor(`${API}/api/health`);
}

async function call(method, path, body, token) {
  const response = await fetch(API + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const stats = async (reset) => (await fetch(STATS + (reset ? "?reset=1" : ""))).json();

// --- Seeding --------------------------------------------------------------------------------------------------
start("calendar-host", [`${here}/calendar-host.mjs`, "8090", profile]);
await waitFor("http://127.0.0.1:8090/x/main.ics").catch(() => {}); // 404 is fine: it is up
await startServer();
const names = Array.from({ length: PEOPLE }, (_, i) => `Person${String(i + 1).padStart(2, "0")}`);
const cli = execFileSync(process.execPath, ["dist/cli.js", "admin-link", names[0]], { cwd: `${root}/server`, env, encoding: "utf8" });
const adminInvite = /#\/einladung\/([\w-]+)/.exec(cli)?.[1];
if (!adminInvite) throw new Error(`no admin link in: ${cli}`);
const tokens = [(await call("POST", `/api/invites/${adminInvite}/accept`, { password: PASSWORD })).token];
for (const name of names.slice(1)) {
  const invite = await call("POST", "/api/admin/invites", { username: name }, tokens[0]);
  tokens.push((await call("POST", `/api/invites/${invite.token}/accept`, { password: PASSWORD })).token);
}
let calendars = 0;
const seedStart = Date.now();
// Four people at a time: the calendar host makes each calendar on first request, and too many at once would run
// into the server's 20 s fetch timeout.
let nextPerson = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (nextPerson < PEOPLE) {
      const i = nextPerson++;
      // Everybody has a private calendar and birthdays; three in five also a work calendar.
      const kinds = i % 5 < 3 ? ["main", "work", "birthdays"] : ["main", "birthdays"];
      for (const kind of kinds) {
        await call("POST", "/api/calendars", { link: `https://cal.loadtest/${names[i]}/${kind}.ics`, name: kind }, tokens[i]);
        calendars++;
      }
    }
  }),
);
const ids = (await call("GET", "/api/people", null, tokens[0])).people.map((p) => p.id);
const sizes = await (await fetch("http://127.0.0.1:8090/sizes")).json();
console.log(`profile ${profile}: ${PEOPLE} people, ${calendars} calendars, ${sizes.totalMB.toFixed(0)} MB of calendar text (largest ${sizes.largestMB.toFixed(1)} MB), seeded in ${((Date.now() - seedStart) / 1000).toFixed(0)} s, heap limit ${heapMB} MB`);

// --- Measuring ------------------------------------------------------------------------------------------------
const dayText = (offset) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
const hoursSearch = { mode: "hours", people: ids, from: dayText(0), to: dayText(364), weekdays: [1, 2, 3, 4, 5, 6, 7], durationMinutes: 120, window: { start: "18:00", end: "23:00" }, bufferMinutes: 0 };
const daysSearch = { mode: "days", people: ids, from: dayText(0), to: dayText(364), days: 2, startWeekday: 6 };

/** Other people using the app meanwhile: a request every 100 ms (health check and own profile), timed. */
function probe(token) {
  const times = [];
  let running = true;
  const done = (async () => {
    while (running) {
      const started = performance.now();
      await call("GET", "/api/me", null, token);
      times.push(performance.now() - started);
      await sleep(100);
    }
  })();
  return async () => {
    running = false;
    await done;
    times.sort((a, b) => a - b);
    return { max: times.at(-1) ?? 0, p95: times[Math.floor(times.length * 0.95)] ?? 0, count: times.length };
  };
}

const rows = [];
async function measure(label, searches) {
  await stats(true);
  const idle = (await stats(false)).nowRssMB;
  const stop = probe(tokens[PEOPLE - 1]);
  const started = performance.now();
  const results = await Promise.all(searches.map(([who, body]) => call("POST", "/api/searches", body, tokens[who])));
  const seconds = (performance.now() - started) / 1000;
  const others = await stop();
  const s = await stats(false);
  const skipped = results[0].skipped.length;
  rows.push({ label, seconds: seconds.toFixed(1), idle, ...s, othersMax: others.max.toFixed(0), othersP95: others.p95.toFixed(0), skipped });
  console.log(`  ${label}: ${seconds.toFixed(1)} s, peak RSS ${s.rssMB} MB, others waited up to ${others.max.toFixed(0)} ms, skipped ${skipped}`);
}

await startServer(); // empty calendar memory, like after a restart or 15 minutes without searching
await measure("1 search, cold (hours)", [[0, hoursSearch]]);
await measure("same search, warm", [[0, hoursSearch]]);
await measure("days search, warm", [[0, daysSearch]]);
await startServer();
await measure("3 searches at once, cold", [[0, hoursSearch], [1, hoursSearch], [2, daysSearch]]);
await startServer();
// Three different groups of 17 at the same time: no fetch is shared.
const thirds = [0, 1, 2].map((k) => ({ ...hoursSearch, people: ids.filter((_, i) => i % 3 === k) }));
await measure("3 groups of ~17 at once, cold", thirds.map((body, k) => [k, body]));

console.log("\n| Case | Duration (s) | RSS before (MB) | Peak RSS (MB) | Peak heap (MB) | Peak buffers (MB) | Event loop max (ms) | Other requests max / p95 (ms) | Skipped |");
console.log("| --- | --: | --: | --: | --: | --: | --: | --: | --: |");
for (const r of rows) {
  console.log(`| ${r.label} | ${r.seconds} | ${r.idle} | ${r.rssMB} | ${r.heapUsedMB} | ${r.externalMB} | ${r.loopMaxMs} | ${r.othersMax} / ${r.othersP95} | ${r.skipped} |`);
}
process.exit(0);
