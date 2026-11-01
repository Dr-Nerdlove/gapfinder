# Lückenfüller – project plan

Agreed with the owner on 2026-10-31. This file records **what** the app does and **why** it is built the way it
is. Change it when a decision changes, and say in the commit why.

## Goal

A mobile-first web app for the owner and their friends (expected 10–20 people, at most 50). Everyone links their
digital calendars; the app finds time slots where all selected people are free, lets everyone vote on them,
and sends the chosen date to everyone. The interface is **German only**; the product name is **"Lückenfüller"**
(repository name: "Gapfinder").

## Architecture

```
 Phone / browser                      Owner's Windows PC (on 07:00–01:00)
 ┌──────────────────────┐            ┌─────────────────────────────────────────┐
 │ Lückenfüller (PWA)   │   HTTPS    │ Hyper-V: Linux VM "lueckenfueller"      │
 │ static files from    │──────────► │  ├─ Tailscale (Funnel) ── end of TLS     │
 │ GitHub Pages         │  via       │  ├─ API server (Docker)                  │
 └──────────────────────┘  Tailscale │  └─ SQLite database file + backups       │
                           Funnel    │ (Home Assistant, Jellyfin: untouched)   │
                           relay     └─────────────────────────────────────────┘
```

- **Frontend:** static site on GitHub Pages, built and deployed by GitHub Actions. Installable as an app
  (PWA). Keeps the last loaded state so it can show it while the server is off.
- **Server:** runs on the owner's home PC, inside its **own small Linux VM in Hyper-V** (Debian, 1 GB RAM,
  dynamically expanding disk with a 10 GB limit – it actually uses about 3–4 GB). The VM isolates the app from
  Windows, Home Assistant, Jellyfin and the owner's files.
- **Reachability:** **Tailscale Funnel**, started inside the VM. The VM opens the connection outwards; nothing
  is opened on the router, and only the app's API is reachable – not the home network, not the WireGuard VPN.
  Free, no own domain needed (address like `<name>.<tailnet>.ts.net`), and TLS ends inside the VM, so the relay
  cannot read the traffic ([Tailscale docs](https://tailscale.com/docs/features/tailscale-funnel)).
  Alternatives considered: Cloudflare Tunnel (needs an own domain, Cloudflare decrypts traffic), a rented
  server as relay (costs money, a second server to maintain), VPN-only (no guests; browsers partly block a
  public site from calling private addresses), the owner's "mailbox" idea (works, but every action would wait
  for the next poll and still needs a third service).
- **Database:** SQLite file inside the VM, nightly backup (below).
- **Backup:** every night at 00:30 (the PC is off from 01:00; a missed backup is made after the next start)
  the server's own CLI writes a consistent copy (`VACUUM INTO`) while it runs. The copy is checked, encrypted
  with [age](https://age-encryption.org/) to the owner's key, kept in the VM (newest 14) and copied over SMB
  to a shared folder inside the owner's **OneDrive** on the Windows PC (newest 60), so it also reaches the
  cloud. Chosen over a cloud storage account (one more outside account and key) and over a plain folder on the
  PC (lost together with the PC's disk). The secret key is never stored in the VM: a break-in there cannot read
  older backups, and the monthly trial restore also proves the owner still has the key. A dedicated Windows
  user can reach only that folder; a firewall rule lets only the Hyper-V Default Switch reach port 445.
  Restore and trial restore: `deploy/vm/backup.sh`, guide in `docs/server-setup.md`.
- **Server off (01:00–07:00 or any outage):** the app shows a friendly notice ("Lückenfüller schläft gerade")
  plus the last loaded state, read-only. Voting resumes when the server is back. (Queueing votes offline is a
  possible later extension.)

### Planned technology (decided in phase 1, recorded here when final)

- Frontend: Vite + TypeScript + Svelte, hash-based routing (GitHub Pages has no fallback for app routes),
  Material 3 look with a colour scheme generated from a seed colour (`@material/material-color-utilities`).
- Server: Node.js + TypeScript + Fastify, SQLite through Node's built-in `node:sqlite` (no native add-on to
  compile), `ical.js` for calendar feeds (recurring events, exceptions, time
  zones), Argon2 for password hashing, all in Docker Compose inside the VM.
- The gap search is a pure function shared by the server and the tests.
- Tests: Vitest for the gap search and the server logic; CI runs build and tests on every push and pull
  request.

## Decisions

### Accounts and roles

- Accounts are created only through an **invite link** the admin (owner) generates.
- Username defaults to first name + initial of the last name ("Vincent R."); it must be unique and can be
  changed.
- Login with username and password. No e-mail addresses; a forgotten password is reset by the admin.
- The admin can rename and delete profiles and reset passwords. The admin does **not** see the contents of
  other people's calendars – nobody does; others only ever see "busy" or "free".
- Decided 2026-11-01 (phase 1c):
  - Invite links are **personal and single-use**: the admin types the person's name, the app suggests the
    username from it, and the link works once and for **14 days**. Only the suggested username is stored, not
    the full name. A group link was rejected: whoever forwards it invites strangers.
  - A forgotten password is reset with a **reset link** the admin creates (once, **24 hours**); the person
    chooses the new password, the admin never knows it. Using it ends all logins of that account.
  - The **first admin** is created with a command in the VM (`admin-link`), which prints an admin invite link;
    the same CLI makes a reset link for the admin's own password (`password-link`). The app never creates
    admins, so nobody on the internet can become one.
  - A login stays valid for **180 days after it was last used**. Changing the password ends the logins on all
    other devices.
  - Failed attempts are limited in memory: 5 wrong passwords per username and 20 per address within 15
    minutes, 30 invalid invite/reset links per address. Trade-off: a stranger who knows a username can block
    its login for 15 minutes; accepted for a friends' app, because it also stops guessing from many addresses.
  - Each user picks a seed colour in the profile (8 presets or an own colour); the app remembers it on the
    device so it shows before the server answers.

### Calendars

- Phase 1 links calendars through their **subscription link (ICS)**: Google "Secret address in iCal format",
  Outlook "Publish calendar", Apple iCloud "Public calendar". Read-only, works for all providers, no app
  registration with Google or Microsoft.
- A user can link several calendars and mark one as **default calendar** (decides which "add to calendar"
  button the user sees first).
- Per calendar: "counts as busy" on/off (e.g. switch off a birthday calendar).
- Events marked as "free" (`TRANSP:TRANSPARENT`) never count as busy. All-day events count as busy unless
  their calendar is switched off.
- The links are stored **encrypted**; only the server reads them. They never reach other users or the admin.
- Direct login with Google/Microsoft (OAuth, read and write) is a possible **later extension**. Apple offers no
  such interface.
- Decided 2026-11-01 (phase 2):
  - **Fetching:** only when needed (one's own preview, later a search), then kept **15 minutes in memory**.
    Calendar contents are never written to disk and never reach a backup. Rejected: an hourly background
    fetch of every calendar (finds broken links earlier, but reads everyone's calendar all the time for
    nothing).
  - **Preview of one's own busy times:** the next **4 weeks**, with time, calendar name and the event's
    **title**. Only the owner of the calendar gets the titles, and they are not stored. Events marked "free"
    show greyed out as "zählt nicht".
  - **Tentative events** ("mit Vorbehalt", Outlook "vorläufig") count as busy; cancelled events never.
  - **A link that stops working:** when the provider says the calendar is gone (e.g. Google's secret address
    was reset), it is marked broken at once; when the provider only does not answer, the next fetch tries
    again. Nothing is ever deleted on its own. The person sees a notice on the start page and next to the
    calendar ("Link neu eintragen"); the admin sees only a count ("1 Kalender mit Problem"), never contents.
    A search (phase 3) shows "Kalender nicht lesbar" for that person instead of counting them as free.
  - **Fetching foreign links safely:** only `https://` (and `webcal://`, which is the same) on the standard
    port; every address, including each redirect (at most 5), must be a public internet address – never the
    home network, the VM, Docker, the Hyper-V host or Tailscale – and the server connects to exactly the
    address it checked. At most 10 MB and 20 seconds per fetch. A new link is tried at once and stored only
    when it works; afterwards the app shows only the provider, never the link. At most 10 calendars per
    person.
  - **Firewall in the VM** as a second line: the server's container may only open HTTPS connections and DNS
    queries to two public resolvers, and nothing in private, Docker, Hyper-V or Tailscale ranges
    (`deploy/vm/firewall.nft`, tested in network namespaces by `deploy/vm/test/firewall.test.sh`).
  - **The key** for the stored links (`CALENDAR_KEY`) is created by `setup.sh` in the VM's `.env` and **travels
    inside every nightly backup**, which is already encrypted with the owner's backup key; a restore puts it
    back. The owner keeps nothing extra. Rejected: a second key the owner keeps separately (a little safer if
    only the backup key leaked, but two keys to keep). If both were ever lost, everyone enters their links
    again; nothing else is lost.
  - The server starts without the key (calendars then report "not set up"): a new image that refused to start
    would be rolled back by the VM before the owner could rerun `setup.sh`.
  - Settled while building 2b: the preview runs from **00:00 German time today** for 28 days (a day with a clock
    change is 23 or 25 hours long); calendars are read for **a day back to 400 days ahead**, so the later gap
    search needs no second read; **checking a link** (a new calendar, or a new link) is limited to **20 per
    person and 15 minutes** (in memory); a calendar **without a name** (none given, none in the feed) is stored
    with an empty name and the app shows the provider's name (Google, Apple iCloud, Outlook, Anderer Anbieter);
    a stored link that cannot be decrypted counts as "not reachable", never as an error; the admin's user list
    carries only the number of broken calendars.
  - Built as two pull requests: 2a the VM side (key, backups, firewall), 2b the calendars in the app.

### Finding gaps

1. Choose friends.
2. Choose either
   - **weekdays + duration**, optionally with a time window (e.g. Saturday, 5 hours, 18:00–23:00). Without a
     time window the default window is **09:00–23:00**; or
   - a **multi-day period** (e.g. 7 days in a row), optionally starting on a given weekday. A day is free when
     it has **no busy event at all**.
   - Optional buffer before and after (travel time).
3. Choose the search range: next 30 / 90 days, half a year, a year, a month, or a custom range of months.
4. Results are **grouped per day** ("Sa 12.12.: alle frei 14:00–23:00") instead of listing every start time.
   When there is no slot for everyone, the app shows the best near misses ("alle außer Max").
- All times are German time (Europe/Berlin), including daylight saving changes.
- Calendars are fetched fresh for a search (kept 15 minutes in memory, see "Calendars").

### Sharing and voting

- A poll gets a share link. **Everyone with the link can vote**, including guests without an account, who
  enter their name. A guest can change their own vote later (from the same device). Votes of account holders
  are marked with a check mark.
- Votes: **Ja / Vielleicht / Nein**; optional voting deadline.
- Everyone sees the current state of the vote.

### Fixing the date

- The **poll's creator or the admin** picks the final date.
- Before fixing it, the server checks the calendars again and warns if someone has become busy meanwhile.
- The date is sent as:
  - a calendar file (`.ics`) to download,
  - "In Google Kalender eintragen" / "In Outlook eintragen" buttons (pre-filled event, one click to save),
  - a **personal "Lückenfüller" calendar feed** each user can subscribe to once; fixed dates then appear in
    their calendar by themselves (note: Google refreshes subscribed calendars only every few hours, sometimes
    once a day).
- Entering a date without confirmation needs the OAuth extension; not part of the first version.

### Look

- Mobile first, Material 3 ("Material You") style, follows the phone's light/dark mode.
- A web page cannot reliably read Android's Material You wallpaper colours (to be verified at the source in
  the design phase). Where the browser offers the system accent colour, use it; otherwise each user picks a
  seed colour in their profile and the full colour scheme is generated from it.
- Installable to the home screen.

## Security

- Only the API is reachable from the internet; it runs as a non-root user in a container inside its own VM.
- The Funnel address is public (it appears in certificate logs and in the built site), so everything behind
  it assumes that strangers will knock: login rate limiting, Argon2 password hashes, CORS limited to the
  GitHub Pages origin, encrypted calendar links, no calendar details in any API response to other users.
- Secrets (encryption key, Tailscale login) live only in the VM (environment file outside the repository).
- Login sessions use a token sent in a header, not a cookie: the site (`github.io`) and the API (`ts.net`) are
  different sites, and browsers increasingly block cookies across sites.

## Phases

Each phase is its own branch and pull request, with screenshots of what is visible. Recommended model per
phase in brackets.

1. **Foundation** (Opus), split into three pull requests: 1a skeleton (repository basics, CI, empty app on
   Pages, server skeleton in Docker), 1b VM + Tailscale Funnel guide with automatic updates, 1c accounts,
   invite links, login, profiles, admin area. Original scope: repository basics (README, `.gitignore`, `CHANGELOG.md`, CI), empty app on GitHub
   Pages, server skeleton in Docker, step-by-step guide for the VM + Tailscale Funnel, accounts, invite links,
   login, profiles, admin area.
2. **Calendars** (Opus): link, manage and test ICS links, default calendar, per-calendar settings, preview of
   one's own busy times.
3. **Gap search** (Opus for the algorithm, Sonnet for the screens): steps 1–4 above, with thorough tests.
4. **Sharing and voting** (Sonnet): share link, guest votes, live state.
5. **Fixing and sending the date** (Sonnet): re-check, `.ics`, add-to-calendar buttons, personal feed.
6. **Optional later:** direct Google/Outlook connection, offline vote queue.

## Server updates

Decided 2026-10-31: **automatic.** CI builds the server image on every merge to `main` and pushes it to GitHub's
container registry (GHCR); the VM checks about once an hour and switches to a new image by itself. The owner
does nothing; frontend and server stay close together. The API still has to stay backward compatible, because
for up to an hour (or overnight, while the PC is off) the new frontend talks to the old server.

How it works (phase 1b, guide: [`server-setup.md`](server-setup.md)):

- A systemd timer in the VM runs [`deploy/vm/update.sh`](../deploy/vm/update.sh) a few minutes after boot and
  then hourly. It pulls `:latest`, starts a new image and waits for its health check. If the new image is not
  healthy, it goes back to the image that ran before and remembers the broken one, so it is not retried every
  hour; the next published image is tried normally. Chosen over Watchtower because it is a short script
  with no extra service and no Docker socket handed to a container, and because it can roll back.
- Because of this rollback, **database migrations must be additive**: an older server has to keep working on a
  database that a newer one has already migrated (it ignores migrations it does not know).
- The files in `deploy/vm/` (compose file, update script, units) are **not** updated automatically: the VM does
  not run new scripts from the internet as root on its own. A change to them means the owner runs `setup.sh`
  again; the release notes must say so.
- Debian security updates and Docker come through `unattended-upgrades`; Tailscale updates itself
  (`tailscale set --auto-update`). No automatic reboot is configured: the PC (and with it the VM) restarts
  every day anyway.

## Open points

- How long old polls are kept.
