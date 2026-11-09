# Load test of the API server (phase 9f)

Measures what a search for 50 people costs the home server: how long it takes with an empty calendar memory, how much
memory the server needs and how long other people's requests wait meanwhile. It runs the real server (the built
`server/dist`, as in the Docker image) on a throw-away database with made-up people and calendars. Nothing here is part
of the app, the server image or CI.

```sh
npm install                                   # once
npm run build:shared && npm run build -w server
node scripts/load-test/run.mjs realistic      # about 3 minutes
node scripts/load-test/run.mjs heavy          # about 6 minutes, every calendar near the 10 MB limit
```

Needs Node 22.13+. Everything lives in `$LOAD_DIR` (default `$TMPDIR/lueckenfueller-load`, deleted at the start of every
run, logs in it). The server runs with a heap limit of 512 MB (`LOAD_HEAP_MB`), what Node should pick by itself on a
machine with 1 GB of memory like the VM (V8's rule: a quarter of the memory, times two on 64-bit, at most 2 GB; on the
16 GB cloud machine it gave 2 GB, on the VM 499 MB, read on 2026-11-09). Ports 8080, 8090 and 8091 must be free.

| File                | What it does                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `calendar-host.mjs` | Stands in for Google and the others: its own process (its memory does not count), plain HTTP on 127.0.0.1, answers `/<person>/<main\|work\|birthdays>.ics` with a Google-like feed (time zone, description, attendees, alarm, weekly and daily series with exceptions, years of history) after 0.3–1.5 s. |
| `server.mjs`        | The real server; calendar links `https://cal.loadtest/...` go through the real `fetch.ts`, only to the local host. Port 8091 answers `/stats`: highest memory and event-loop delay since the last `/stats?reset=1`. |
| `run.mjs`           | Starts both, makes 50 accounts with 130 calendars through the API (everybody a private calendar and birthdays, three in five also a work calendar), restarts the server (empty calendar memory) and measures, while one more person asks for their profile every 100 ms. Prints a table. |

Profiles: **realistic** gives private calendars of 0.2–3.5 MB (107 MB in all), **heavy** 9.5 MB for every private and work calendar (770 MB in all), far
more than real calendars of the circle are likely to be, as an upper bound.

What it measures (columns of the table): the search's duration; the server's memory (RSS, what the VM has to give it)
before and at the highest; the JavaScript heap at the highest (512 MB is the limit); buffers outside the heap; the
longest the server could not answer anything (event loop); how long the other person's requests took at most and in 95
of 100 cases; how many people the search left out (must be 0).

Things to know:

- The cases: one search for all 50 over a year (hours, then days with the memory filled); three searches at the same
  time for the same people (they share the reading); three searches at the same time for three different groups of
  about 17 (nothing shared).
- The duration of a first search is mostly the made-up waiting for the calendar services (130 calendars, 8 at a
  time, 0.3–1.5 s each); how fast Google, iCloud and Outlook really answer is not known here.
- Reading one calendar runs in one piece, so meanwhile the server answers nothing: 0.05–0.25 s per MB of calendar on the
  cloud machine (series take longer than single events). The VM may be slower or faster.
- The server's memory (RSS) does not shrink much after a search: Node keeps what it once took for later.
- Results of 2026-11-09 and what was decided: `docs/PLAN.md`, point 9f.
