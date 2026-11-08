# Documentation screenshots

Takes the pictures in `docs/screenshots` that show the whole app (login, invite, start page, profile, admin area,
search with groups and "Fast alle", the poll's calendar check, fixing the date) in one run, with made-up people and
calendars on a throw-away server. Nothing here is part of the app, the server image or CI.

```sh
npm install                                   # once
bash scripts/docs-screenshots/run.sh          # pictures go to $SHOTS_DIR/out (default /tmp/lueckenfueller-shots/out)
bash scripts/docs-screenshots/run.sh --install   # ... and are copied into docs/screenshots
```

Needs Node 22.13+ and Playwright with Chromium (`require('playwright')`; cloud sessions have both). It takes about
two minutes. `run.sh` builds `shared` and the server, starts the web app (`vite`, port 5173) and the fake server (port
8080), seeds them, takes the pictures and stops both again.

| File              | What it does                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `fake-server.mts` | The real server, but calendar links `https://cal.example/<name>.ics` answer with a made-up calendar for `<name>` (no network, `fetch.ts` is not involved). |
| `seed.mjs`        | 14 accounts (Vincent is the admin, made with the CLI like on the real server), a calendar each except Lena, two groups, one poll, one open invite. |
| `lib.cjs`         | Phone-sized browser (390x844, scale 2, German, Berlin time), login helper.                                      |
| `shoot.cjs`       | The pictures, one after the other. Fixing the date changes the poll, so it is the last step.                    |
| `run.sh`          | Runs all of it. Everything lives in `$SHOTS_DIR` and is deleted at the start of every run.                      |

Things to know:

- The pictures show made-up names, and dates that depend on the day of the run (the poll uses the first two Saturdays
  at least a week ahead). Sophie's calendar is busy on one of them and free on the other, so the poll picture always
  shows both hints; Max's calendar fails after a restart of the fake server (`broken-Max`), Lena has none.
- Open the app as `http://localhost:5173` (the server's CORS default). With `127.0.0.1` the app believes the server sleeps.
- The development build has no service worker, so the notification card would say "gesperrt"; `lib.cjs` makes
  `Notification.permission` read "default". The notification pictures in `docs/screenshots/notifications` are not made here.
- The start picture is cropped above the version line, which changes with every release.
- A text or button that changes in the app can break a script step (they find things by their German text): fix the step
  in `shoot.cjs`; the run stops with Playwright's error and the step's line.
- Pictures that are not made here (search result for days, "Server off", notifications, "Meine Abstimmungen", calendars,
  Android) are older and are retaken by hand when their screen changes.
