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
  user can reach only that folder; a firewall rule lets only the VM's fixed home-network address reach port 445.
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
- The username is fixed by the admin when inviting (decided 2026-11-03): the first name alone when it is
  unique in the group, otherwise plus an initial or more letters, e.g. "Samuel H.", "Samuel Kr.", "Samuel Kö.".
  It must be unique. Users cannot change it; only the admin renames (admin area). Duplicates, including names
  of open invites, are refused at invite time.
- Login with username and password. No e-mail addresses; a forgotten password is reset by the admin.
- The admin can rename and delete profiles and reset passwords. The admin does **not** see the contents of
  other people's calendars – nobody does; others only ever see "busy" or "free".
- Decided 2026-11-01 (phase 1c):
  - Invite links are **personal and single-use**: the admin types the person's exact username (see above), and
    the link works once and for **14 days**. Only the username is stored. A group link was rejected: whoever forwards it invites strangers.
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
  - Decided 2026-11-03: two switches per calendar, **"Stunden"** (hour search, and fixing a timed poll date) and
    **"Ganze Tage"** (multi-day search, and fixing a whole-day poll date). Existing calendars take over their old
    setting for both. The search choices are renamed to "Stunden" and "Ganze Tage" to match. The old field
    `countsAsBusy` is kept (it means the hour search) so older servers and apps keep working.
  - Decided 2026-11-03: in the multi-day search (and the check before fixing a whole-day poll date) only events
    of **at least 6 hours** count as busy (`DAYS_SEARCH_MIN_EVENT_HOURS`): holidays, trips, all-day events and
    long shifts block a day, a dentist appointment does not. The "Ganze Tage" switch stays for calendars whose
    long events (work shifts) should not block a holiday. The hour search is unchanged; the calendar preview
    does not mark short events.
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
- Decided 2026-11-03 (privacy question from a user: "can the admin read my appointments?"):
  - **What is true:** in the app nobody but the owner sees contents (others: busy/free; admin: a count of broken
    calendars). But whoever runs the VM can read every calendar: `CALENDAR_KEY` sits in the VM's `.env` next to
    the database, so database + `.env` decrypt the links, and a Google or iCloud link shows the whole calendar,
    future events included, without the app. A second path: the admin creates a password reset link and uses it
    (the person notices: all their logins end). "Never, under any circumstances" is not reachable while the
    server reads calendars for everyone: whoever runs the server can change what it does.
  - **Chosen: explain it honestly** (page `#/privatsphaere`, linked from the calendar page and the tour) and
    recommend Outlook's "Kann nur Verfügbarkeit anzeigen", which keeps titles out of the link itself. Google
    and Apple have no such option for their links.
  - **Kept for later (option B):** the link encrypted with a key that only the person's device holds; the
    server reads the calendar only while the person uses the app and keeps only busy blocks (no titles), so
    database + `.env` alone reveal nothing beyond busy/free. Costs: searches use the state from each person's
    last visit (shown as "Stand vor X Tagen"), a new device or a password reset needs the link entered again,
    busy blocks are stored (today nothing is). Existing links could be moved over automatically on the next
    visit. A deliberately changed server could still catch a link while the person is online.
  - **Rejected:** each phone fetches its own calendar so the server never sees the link: as far as known
    (not verified, the cloud session cannot reach the providers) Google, Apple and Microsoft do not allow such
    requests from a web page (CORS).
- Decided 2026-11-03: **guided tour** for new users (6 steps, a modal on the start page), shown once per user
  and device (stored in `localStorage`, marked seen as soon as it opens; without storage it is never shown on
  its own), again any time with "Einführung" on the start page. Not stored on the server, so it needs no server
  update. The **calendar guide** asks first which calendar the person uses and shows steps for phone and
  computer; Google's section is called "Kalender integrieren" and works in the phone's browser (desktop view).

### Finding gaps

1. Choose friends.
2. Choose either
   - **weekdays + duration** (the choice "Stunden"), optionally with a time window (e.g. Saturday, 5 hours,
     18:00–23:00). Without a time window the default window is **09:00–23:00**; or
   - a **multi-day period** (the choice "Ganze Tage"; e.g. 7 days in a row), optionally starting on a given
     weekday. A day is free when nobody has an **all-day event or an event of at least 6 hours** on it
     (shorter events do not count).
   - Optional buffer before and after (travel time).
3. Choose the search range: next 30 / 90 days, half a year, a year, a month, or a custom range of months.
4. Results are **grouped per day** ("Sa 12.12.: alle frei 14:00–23:00") instead of listing every start time.
   When there is no slot for everyone, the app shows the best near misses ("alle außer Max").
- All times are German time (Europe/Berlin), including daylight saving changes.
- Calendars are fetched fresh for a search (kept 15 minutes in memory, see "Calendars").
- Decided 2026-11-01 (phase 3):
  - **Who can be searched with:** everyone with an account can choose everyone else with an account (a small
    circle that only an invite gets into). Rejected: a profile switch "appear in other people's searches"
    and confirmed friendships (more to build and to click, for little gain among friends). Trade-off: whoever
    searches often can roughly tell when someone is usually busy; nobody ever sees an event.
  - **The searcher is always part of their own search.**
  - **Near misses:** a second list "Fast alle" below the results, always shown (also when there are results for
    everyone), with the name of the one person who is missing; only slots where **exactly one** person is
    missing, and only when the search has at least 3 readable people. A near miss is left out when it lies
    entirely within a result for everyone. Rejected: up to two missing (long lists), near misses only when
    nothing fits everyone, and "Max only from 20:00" hints (reveal more of someone's day). Revised by 9c (a fifth
    may be missing, see "Growing the circle").
  - **Unreadable calendars:** a person with no calendar, or with any calendar that cannot be read right now
    (broken, unreachable, or so large that it was not read completely), is **left out of the search with a
    clear notice** ("Max: Kalender nicht lesbar – nicht berücksichtigt"); with only one of several calendars
    unreadable, the whole person is left out, or they would look free when they are not. Rejected: refusing to
    search until every calendar is readable (one broken link would block the whole group).
  - **Multi-day results are merged:** one line per free stretch ("3.–16. Aug.: alle frei (14 Tage)"); with a
    starting weekday, the line says on which of those weekdays the period can start. Rejected: every possible
    start as its own line (very long lists).
  - Settled with the owner before building: results are **not stored** (a poll in phase 4 is made from chosen
    results; the device remembers the last search settings); each day shows all its free windows that are long
    enough, with the buffer already taken off, and today only from now on; the time window may **cross
    midnight** (20:00–02:00 belongs to the day it starts); time window in half hours and duration in whole hours (the API still accepts quarter and half hours); buffer 0–2 hours in half hours (the API still accepts quarter hours), only for
    weekdays + duration (in a multi-day search the whole day is empty anyway); search range at most a year;
    at most 50 people per search and 30 searches per person every 15 minutes. A new list of all accounts (only
    username and colour) is visible to everyone with an account.
  - Settled while building 3a: a multi-day period starts **tomorrow at the earliest** and always lies entirely
    inside the search range; the range starts today at the earliest and ends at most 365 days ahead (calendars
    are read 400 days ahead); a window that started yesterday and crosses midnight is not offered (the range
    starts today); a wall time that does not exist on the spring change day counts as 03:xx, one that exists
    twice in autumn as the earlier one; at most 8 calendars are read at the same time per search; invalid
    searches do not count towards the limit. Routes: `GET /api/people`, `POST /api/searches` (types in
    `shared/src/gaps.ts`, the pure search in `server/src/gaps/search.ts`).
  - Built as two pull requests: 3a the search and the server routes, 3b the screens.
  - Settled with the owner before building 3b (preview mock-up): **one page** `#/suche` (settings on top, result
    below, no steps); the device remembers the last settings and the chosen people (a person without an account
    any more is dropped quietly; new accounts are not preselected); a custom range is "from month – to month"
    (this month and the next twelve; the start never lies in the past, the end is cut off 365 days ahead); each
    list shows 10 lines, then "Mehr anzeigen"; people who were left out are named in a notice above the lists.
    While the server sleeps the people list cannot load, so the form waits (the settings are kept); the search
    request waits up to 90 seconds because the server reads calendars fresh. Logic and tests:
    `web/src/lib/gap-search.ts`.

### Sharing and voting

- A poll gets a share link. **Everyone with the link can vote**, including guests without an account, who
  enter their name. A guest can change their own vote later (from the same device). Votes of account holders
  are marked with a check mark.
- Votes: **Ja / Vielleicht / Nein**; optional voting deadline.
- Everyone sees the current state of the vote.
- Decided 2026-11-02 with the owner before building 4a (all recommendations taken):
  - **Proposals:** 1 to 20 per poll. A proposal is an **exact time** (start and end on 15 minutes, at most 24
    hours, chosen inside a free time of an hours search; the screen suggests the searched duration from the start
    of the gap) or, from a multi-day search, a run of **whole days** (tomorrow at the earliest, at most 31 days).
    Rejected: the whole free window with the time fixed later (phase 5 needs an exact time for `.ics` anyway).
    Proposals cannot be changed after creating the poll (the votes would no longer fit); a new poll instead.
  - **Changing a vote:** an account votes as itself (one vote, from any device). A guest's device gets a secret
    vote key when voting and keeps it; with it the vote can be changed or withdrawn on that device. Another
    device or cleared browser data means a new vote (the creator can remove the old one). Rejected: matching by
    name (anyone could change other people's votes) and no changes at all.
  - **Lifetime:** a poll is deleted automatically **30 days after its last proposal ends**; the link then stops
    working. Rejected: 90 days after creating, never.
  - **Managing:** the **creator and the admin** can change title, note and deadline, close and reopen the poll,
    remove single votes, make a **new share link** (the old one stops working) and delete the poll. When the
    creator's account is deleted, the poll stays and only the admin manages it.
  - **Delete but keep the date:** for a poll with a fixed date, `POST /api/polls/:id/remove-keeping-date` (creator or admin)
    deletes votes, other proposals and notifications and sets `polls.removed_at`; the poll is gone for the app (all
    lookups exclude it), but its fixed date stays in the personal calendar feed, for the same people as before (voters
    become participants, people who said "no" are removed, the creator is cleared if the creator said "no"), until
    `expires_at`, when `purgeExpired` deletes it. A separate route, because an older server would ignore a flag on `DELETE`.
  - **Abuse limits:** only account holders create polls, at most 20 each that are not yet deleted; the share link
    is a random 128-bit secret, masked in the request log; at most 100 guest votes per poll; 30 guest vote
    writes per address in 15 minutes; wrong share links count like wrong invite links (30 per address). Guest
    names are 1–40 characters and may be neither an account's username nor another guest's name in the same
    poll, so nobody can pose as "Vincent R.". Trade-off: whoever has a link can probe whether a username exists;
    usernames are not secret among the friends.
  - **Visibility:** everyone with the link sees each voter's name and answers, and the participants (the people
    of the search, so the screen can show "noch nicht abgestimmt"; phase 5 re-checks their calendars). Rejected:
    sums only for guests.
  - Settled while building 4a: the share token is stored as it is (the creator and the participants can open the
    link again; it is meant to be passed on), guest vote keys only as hashes. A logged-in caller sees their polls
    in a list (created, taking part, or voted). The state is refreshed by asking again (every 30 seconds while the
    page is open), not pushed. Every voter answers every proposal. Routes and types: `shared/src/polls.ts`,
    server in `server/src/routes/polls.ts` and `server/src/polls/`.
  - Built as two pull requests: 4a the server, 4b the screens.
  - Settled with the owner before building 4b (preview mock-up, all recommendations taken): free times are
    chosen with a check on each time (each free time of a day is its own choice; near misses too) and a bar
    "N Termine gewählt – Abstimmung anlegen" at the bottom; start and end are two selects in half-hour steps (plus the start and end of the free time itself, which can sit on a quarter hour), the poll deadline time in half hours
    inside the gap; the state is a table people × dates with sums, the best date (most "Ja", then fewest
    "Nein") highlighted and "Noch nicht abgestimmt" below; "Meine Abstimmungen" is its own page
    `#/abstimmungen` with a button on the start page. Routes: `#/abstimmung/<token>` (no login needed),
    `#/abstimmung-neu` (the choice is handed over in memory only; a reload asks to search again). The guest's
    vote key and last name live in localStorage (`lueckenfueller.guest-votes`, at most 50 polls). While the
    server sleeps the last state stays on screen, buttons are disabled and the page retries every 30 seconds.
    Logic and tests: `web/src/lib/poll-draft.ts`, `poll-view.ts`, `poll-actions.ts`, `guest-votes.ts`,
    `polling.ts`.

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
- Decided 2026-11-02 with the owner before building 5a:
  - The creator or an admin fixes one proposal as the final date; it can later be changed to another proposal or
    taken back. Fixing makes the poll not accept votes (`open` is false); taking it back opens it again unless
    it is closed by hand (`closed` stays a separate flag) or past its deadline.
  - The check before fixing is a warning only and never blocks fixing. It lists who is busy, whose calendar
    cannot be read and who has no calendar, never titles or times, and counts like a search in the same
    rate-limit bucket.
  - Everyone with the share link (guests too) can download the fixed date as `.ics`.
  - The personal feed has one secret link per account (stored as is, renewable, can be switched off). It holds
    the fixed date of every poll where the person is creator, participant, or has an account vote, except polls
    where the person's own account vote says "no" to the fixed proposal.
  - Old dates vanish with the poll (deleted 30 days after the last proposal; `expires_at` is unchanged).
  - The `.ics` files carry no link to the poll: the server does not know the app's page address. The frontend
    (5b) builds the "In Google Kalender eintragen" / "In Outlook eintragen" buttons itself.
  - Where it lives (5a, server): migration 5 in `server/src/db.ts` (`polls.fixed_proposal_id`, `fixed_at`,
    `fixed_sequence`, table `calendar_feeds`); types `FixPollRequest`, `FixCheck`, `CalendarFeed` and the
    `poll_not_fixed` code in `shared/src/polls.ts` and `index.ts`; routes `PUT/DELETE /api/polls/:id/fixed`,
    `POST /api/polls/:id/fix-check`, `GET /api/poll-links/:shareToken/event.ics` in `server/src/routes/polls.ts`
    (later: `GET /api/poll-links/:shareToken/calendar-check`, the "Nicht berücksichtigt" card and the own-calendar hints on the poll page)
    and `GET/POST/DELETE /api/me/calendar-feed`, `GET /api/calendar-feeds/:token` in `server/src/routes/feeds.ts`;
    the calendar file writer is `server/src/calendars/ics-write.ts`, the shared calendar reading
    `server/src/calendars/busy.ts`, the feed contents `server/src/polls/feed.ts`. A wrong feed token is not
    counted in the per-address bucket (calendar services share addresses; the token cannot be guessed).
  - Decided 2026-11-10: the profile shows, per kind of calendar app (Google, Apple, Outlook, other), when the feed was
    last fetched. Only the app kind (told from the `User-Agent`, `server/src/calendars/feed-app.ts`) and the time are
    stored, in table `calendar_feed_fetches`; renewing the link or switching the feed off clears them. Reason: Google
    refreshes subscribed calendars only every few hours or less, and users could not tell whether their feed arrives.
- Settled with the owner before building 5b (preview mock-up, all recommendations taken except Outlook): the
  creator or admin picks the date in an own card "Termin festlegen" (a list of the proposals, the best one
  preselected), the button "Kalender prüfen und festlegen" always shows a confirmation, with the warning when
  someone is busy, unreadable or without a calendar, or a note when the check itself failed; fixing is allowed in
  every case. The fixed date is shown to everybody in a highlighted card with three buttons; the voting form is
  gone and the table highlights the fixed column. Outlook: **one button, private accounts only**
  (`outlook.live.com`); work accounts use the `.ics` file. Link formats (checked at the source, the maintained
  add-to-calendar notes by InteractionDesignFoundation, there is no official Microsoft text): Google
  `calendar.google.com/calendar/render?action=TEMPLATE&text&dates&details`, timed as UTC
  `YYYYMMDDTHHmmssZ/…`, whole days `YYYYMMDD/YYYYMMDD` with the day after the last day as the end; Outlook
  `outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject&startdt&enddt&body`,
  `allday=true` with plain dates. Tried by the owner on 2026-11-02: Outlook reads `enddt` of a whole-day event as
  the last day (inclusive), so the app sends the last day there (Google and `.ics` stay exclusive). The owner
  confirmed the corrected Outlook link on 2026-11-02 (3–4 Jan. shows as 2 days). "Meine Abstimmungen" shows
  "Termin steht: <date>" in the writing of the poll page (`fixedTag` in `web/src/lib/poll-view.ts`) and keeps
  "Termin steht ✓" when an older server sends no `fixedProposal`.
  Built in `web/src/lib/fix-date.ts` (fixed proposal, links, check review), `calendar-feed.ts`, new calls in
  `api.ts` (the `.ics` is fetched by the app, so a sleeping server shows a message and not the browser's error
  page), screens `components/polls/FixDate.svelte`, `FixedDate.svelte`, `components/CalendarFeed.svelte`.
  Backward compatible: a server without 5a sends no `fixedProposalId`, so the app hides the fixing card and
  treats the poll as not fixed; the profile card says the feature is not on the server yet (the missing route
  answers 404).

### Notifications

Decided with the owner on 2026-11-04 (all recommendations taken). Phase 6 (web, Web Push) and phase 7 (Android
app) below.

- **Kinds and who gets them** (accounts only; "involved" = the creator, the participants of the search and the
  accounts that voted; the person who caused it never gets their own notification):
  - **New poll** (`poll_created`): every participant except the creator.
  - **Someone voted** (`vote`, a new or changed vote of an account or a guest; deleting a vote sends nothing):
    the creator by default, the other involved accounts only if they switch it on.
  - **Everyone has voted** (`all_voted`): once, when the last participant without a vote votes; the creator by
    default, the others only if they switch it on.
  - **Date fixed** (`date_fixed`, also when it is changed to another proposal; unfixing sends nothing): the
    involved accounts that answered "Ja" or "Vielleicht" to exactly that proposal, and the participants who
    have not voted. Whoever answered "Nein" to it gets nothing.
  - **Reminder** (`reminder`): only the creator can send it, from the poll page, to the participants without a
    vote; at most once per 24 hours per poll ("Erinnerung gesendet um 14:05"), not once the date is fixed.
- **Settings:** each user switches every kind on or off in the profile. Defaults: new poll on, someone voted on
  for one's own polls and off for others', everyone voted the same, date fixed on, reminder on. Separately,
  each device is switched on once ("Benachrichtigungen auf diesem Gerät erlauben"); a user can have several.
- **Guests** get no notifications for now (it would mean storing device data of people without an account).
- **Texts:** the server sends no text, only structured data (kind, poll title, share token, who, which date);
  the app (service worker) and later the Android app make the German text, like everywhere else.
- **Stored on the server:** every notification is kept per recipient for **7 days** (then deleted), so the
  Android app can fetch what is new; Web Push subscriptions (browser address and keys) until the browser
  reports them gone, the user switches the device off or logs out, or the account is deleted. Both are
  personal data, named on the privacy page.
- **Web Push (phase 6):** the server makes its own key pair (VAPID) on first start and keeps it in `meta`, so
  nothing has to be set up in the VM and a restored backup keeps working subscriptions. Messages are encrypted
  for the browser; the browser's push service (Google, Mozilla, Apple, Microsoft) only passes them on. The
  server only sends to the known push services (https, port 443, fixed host list), because the subscription
  address comes from the client. Library: `web-push` (the encryption is too delicate to write by hand). The
  firewall already allows it (TCP 443). iPhones get notifications only for the app added to the home screen
  (iOS 16.4+); the app says so. An older server answers 404 for the new routes: the profile card then says
  the feature is not on the server yet.
- **Android app (phase 7):** for a friend who uses no browser (Pixel, Android 16/17, with Google services).
  - A Capacitor app that loads the live app from GitHub Pages (like the browser does), so it is always up to
    date and the API needs no new CORS origin; a new APK is only needed when the app shell changes.
  - Notifications without Firebase: the app checks the server about every 15 minutes in the background
    (WorkManager) for notifications newer than the last one it has seen, and shows them itself. They can
    arrive up to ~15 minutes late (later when the phone has been idle for long). Rejected: Firebase (an extra
    Google account, Google reads the text), ntfy/UnifiedPush (an extra app and service), a foreground service
    as in the owner's Marvel Remix project (fits a one-hour game, not a poll that runs for days).
  - Delivered as an APK attached to the GitHub release, signed with a fixed key from GitHub secrets (pattern
    of the owner's Game Night project, with the fingerprint check). The app updates itself like Marvel Remix:
    it offers a newer version, keeps a downloaded APK until it is installed (so a cancelled "install unknown
    apps" prompt does not mean downloading again), and deletes older ones.
  - Where the update comes from (decided by the owner on 2026-11-04): the app downloads it directly from the
    latest GitHub release (the repository is public), not from the own server. The home server stays out of
    it: no new route, nothing to change in the firewall. Every release has its APK attached.
  - On the phone only the newest downloaded APK is kept until it is installed; older ones are deleted
    (decided by the owner on 2026-11-04).
  - Further decisions (owner, 2026-11-04, all recommendations taken):
    - **Login of the background check:** its own **device key**, not the login token. Switching notifications on
      in the app registers the phone (`POST /api/app-devices`) and gets a key that can only read the
      notification list (`GET /api/app-notifications`, key in the `X-Device-Key` header, never in the URL). Only
      its hash is stored. It is deleted when the device is switched off, at logout, whenever the user's sessions
      are ended (password change or reset) and with the account; an unused key goes after 90 days. Why not the
      login token: a check every 15 minutes would keep the login alive forever (it expires only after days
      without use), and the check could go on with a stale login after a logout it missed; the key ends cleanly
      instead and gives the background check no more rights than it needs. It does **not** protect a lost phone:
      the app itself stays logged in there, like a browser does. The first answer names the newest
      notification, so a newly switched on phone does not show the last 7 days.
    - **Signing key:** made by the owner inside the VM with one `docker run` command (keytool), then put into
      two GitHub secrets. It never passes through a chat or the repository.
    - **Update:** every release has its APK, but the app offers an update only when the Android shell itself
      changed (its own shell version, not the app version), because the content comes from GitHub Pages anyway.
    - **Three pull requests:** 7a server and web app (device key, the app's notification switch, share, `.ics`
      and calendar buttons through Android), 7b the Android app (shell, background check, signing, APK in the
      release), 7c self-update.
    - The Android project (`android/`) is kept in the repository, not generated in every build as in Game Night,
      because it carries own native code (background check, update).
    - **7b decisions (owner, 2026-11-04):**
      - App id `de.drnerdlove.lueckenfueller`.
      - The app loads the live web app from GitHub Pages through `server.url`, although Capacitor documents it as
        "not intended for use in production": no new APK for content changes, no new CORS origin. `server.errorPath`
        (`android-www/offline.html`) is shown when the page cannot be loaded.
      - A signed test APK on every pull request and push to `main` (changed 2026-11-12; Actions artifact `lueckenfueller-apk`, 14 days) once the secrets exist, and an
        APK in every release, built by `release.yml`; no release without the APK (missing secrets or a signature that
        differs from `android/signing-fingerprint.txt` stop it).
      - The owner keeps the copy of the signing key themselves (outside GitHub); lost key = everybody reinstalls.
      - One notification channel, "Abstimmungen". Texts are made in the app in Europe/Berlin time, like the web app.
      - The web app does not register its service worker inside the app (the app has its own notification path).
    - **Material You colours (owner, 2026-11-04):** the plugin method `systemColors()` returns the five system
      palettes (`system_accent1..3`, `system_neutral1..2`, 13 shades each, read by name like the owner's Game Night);
      the web app turns them into the same colour variables as the seed path (shade N = tone 100 - N/10). Details in
      `docs/android-app.md`. The last palettes are cached on the device so the colours show at start.
    - Inside the app, "Teilen", ".ics herunterladen" and links to other sites (Google/Outlook, `webcal://`)
      go through the Android app (`web/src/lib/native.ts`), because the Android web view cannot share, download
      or open other apps on its own. In the browser nothing changes.
    - **Test on the owner's phone (2026-11-05):** the chain works (server, background check, display): a test
      notification appears, and "Jetzt nachsehen" shows new notifications at once. Waiting for the 15-minute check
      was too slow for the owner, so instant delivery follows (phase 7d below).
  - **Instant delivery through Firebase as a "doorbell" (phase 7d, decided by the owner on 2026-11-05):** the
    earlier "no Firebase" (2026-11-04) is revised, because the doorbell sends Google no content.
    - When the server stores a notification for an account, it sends a Firebase Cloud Messaging (FCM) data message
      **without any content** (no title, text, poll or name; at most a fixed kind like `check`) and with high
      priority to that account's app devices. The app then runs the same check as "Jetzt nachsehen" (device key,
      `GET /api/app-notifications`) and shows the texts it makes itself. Google only learns that a device was rung.
    - The 15-minute background check **stays** as a fallback (phones without Google services, a lost ring, the
      server off at night).
    - Server: Google's `google-auth-library` for the service-account login (OAuth2 access token for the FCM HTTP
      v1 API), the ring itself is one `fetch` to `fcm.googleapis.com`. Not `firebase-admin` (large, mostly unused),
      not a hand-made login. The service-account key lives only in the VM (like `CALENDAR_KEY`; `setup.sh` asks for
      it), never in the repository or a backup copy in plain text; the server must start without it or with a bad
      one (no ring then, the fallback carries on), so a missing key never makes the VM roll back. The firewall
      already allows TCP 443. Logs name the status, never a token.
    - The app registers its FCM token with the server together with its device key (additive migration on
      `app_devices`; the token is personal data: privacy page). The server forgets it with the device key, and
      when FCM reports it unregistered. A token refresh is sent again.
    - `google-services.json` (Firebase's app configuration) is committed: it is not secret (it is inside every
      APK); in Firebase the key is restricted to the app id and the signing fingerprint. The owner creates the
      Firebase project from a written guide (a session cannot create accounts).
    - Order: 7d is built **before** the first release with the Android app (1.6.0), so friends get instant
      notifications from their first install (the self-update, 7c, comes later).
    - **Decisions taken while building (2026-11-05):**
      - Route `PUT /api/app-devices/push-token` (device key header `X-Device-Key`) stores or, with no token, deletes
        the phone's FCM token and answers `{instant}` (true when the server can ring at all).
      - The ring is data only: `kind: check`, Android priority high, time to live 1 day, `collapse_key` `check` (a
        phone that was off gets one ring, not many). No title, text or name.
      - A token is cleared when FCM answers UNREGISTERED or SENDER_ID_MISMATCH (HTTP 404 without a code); other
        errors keep it. Error handling follows firebase-admin's source, as the FCM docs were not reachable.
      - Server setting `FCM_SERVICE_ACCOUNT` = base64 of the service-account JSON, written to `.env` by `setup.sh`,
        which then deletes the key file. It is not in the backups (new key after a rebuild).
      - Admin card "Sofort-Benachrichtigungen (Android)" reads `/api/admin/doorbell-status` (ready or not, phones
        with a token, last ring; the last ring is kept in memory only).
      - App: Firebase auto-init is off until the user switches notifications on; then the token is sent, and resent
        daily and on a token change; switching off deletes it. Every Firebase call is guarded, so the app builds and
        runs without `google-services.json` (no ring then).
      - A ring is handled directly in the FCM service (same check as "Jetzt nachsehen"); WorkManager is the fallback.
      - The profile card says "sofort" only when the server answered `instant=true`.
      - Guide for the owner: `docs/firebase-setup.md`.
    - **Test on the owner's phone (2026-11-05):** the doorbell works.
      - The service-account key was put on the VM with `setup.sh`; the admin card "Sofort-Benachrichtigungen (Android)"
        shows "Bereit".
      - With the test APK from the CI run after PR #66 installed, a guest vote through the share link produced a
        notification that arrived at once on the locked phone.
      - Step 4 of the Firebase guide was done: the API key is restricted to the package name
        `de.drnerdlove.lueckenfueller` and the SHA-1 fingerprint
        `08:AF:87:5D:DE:65:17:6C:7E:EE:98:41:3A:EC:63:B2:38:0C:A2:A9`. The notification kept arriving at once afterwards.
      - The English menu names in `docs/firebase-setup.md` were all correct.
  - **7c decisions (owner, 2026-11-05):** the app updates itself.
    - An update is offered only when the latest GitHub release has a **higher shell version** than the installed app
      (`BuildConfig.SHELL_VERSION`), not for every app version. `SHELL_VERSION` is 3 with this change.
    - The app installs inside the app: it downloads the APK itself and hands it to Android's installer
      (`PackageInstaller` session); Android asks the user to confirm.
    - Shown as a card at the top of the start page when an update is available, plus the state in the profile.
    - **Technical choices:**
      - Every release carries `app-update.json` (`scripts/app-update-json.sh`, uploaded by `release.yml` in the same
        `gh release create` call as the APK): `{"version","shell","apk","sha256"}`. The app reads
        `https://github.com/Dr-Nerdlove/gapfinder/releases/latest/download/app-update.json`; releases before 1.7.0
        have none (404), which is the state "unknown" and shows nothing.
      - Redirects are followed by hand (https only, hosts `github.com`, `release-assets.githubusercontent.com`,
        `objects.githubusercontent.com`, at most 5 hops); limits 64 KiB for the JSON, 64 MiB for the APK.
      - The JSON is parsed strictly (version `x.y.z`, shell a positive integer, `apk` exactly
        `lueckenfueller-<version>.apk`, 64 hex SHA-256). The APK address is built by the app, never taken from the JSON.
      - Before the installer is called, in this order: SHA-256 of the download equals the JSON; the package name is
        our own; the signing certificates equal the installed app's; the version code is higher. Any failure is
        a reason code (`download`, `checksum`, `package`, `signature`, `version`, `install`), never an exception text.
      - Without the permission to install from this app (API 26+), the app opens the system settings page and
        answers `needs-permission`; the user comes back and taps again.
      - Plugin methods `appUpdate()` (`available`, `current`, `unknown`) and `installAppUpdate()` (`started`,
        `needs-permission`, `failed`); the second one reads the JSON again and trusts nothing from the web app.
      - **The installed 1.6.0 app (shell 2) has no `appUpdate` method.** Capacitor rejects the call as
        "UNIMPLEMENTED"; the web app then shows a card asking the user to install the new version by hand once
        from the release page. From shell 3 on, updates are offered by the app itself.
      - The privacy page says that the app asks GitHub once per start whether a new version exists.
    - **Verified on the owner's phone on 2026-11-05** with release 1.7.0: the 1.6.0 app showed the "install by
      hand" card; a test APK 1.6.99 with shell 2 (branch `test/self-update-older-shell`, never merged) installed
      over it by hand kept the login; it then offered "Neue App-Version – Version 1.7.0", asked once for the
      permission to install from this source and Android asked to confirm; afterwards 1.7.0 was installed, the
      login was still there and the profile showed "App ist aktuell".

### Look

- Mobile first, Material 3 ("Material You") style, follows the phone's light/dark mode.
- A web page cannot reliably read Android's Material You wallpaper colours (to be verified at the source in
  the design phase). Where the browser offers the system accent colour, use it; otherwise each user picks a
  seed colour in their profile and the full colour scheme is generated from it.
- **Material You in the Android app (decided by the owner on 2026-11-04):** inside the Android app (Android 12+),
  the app wears the phone's full system palette, so it matches the other apps. A per-device switch in the profile,
  "Farben vom Handy übernehmen" (on by default; shown only inside the app and only when the phone has system
  colours), turns it off; then the profile's seed colour applies as before. In the browser nothing changes.
- Installable to the home screen.

### Growing the circle (phase 9)

Decided with the owner on 2026-11-07, after a review of the whole project with a view to the circle growing from
10–15 users (today) to 50 or more. The owner names a point by its number ("9a") to start it in a session. Each
point is its own branch and pull request; the details marked "to settle" are agreed with the owner (choices with a
recommendation, a preview mock-up where something is visible) **before** building, and recorded here.

Order of work:

- **9a Own groups in the people choice** (Sonnet; the server part is small). With 50+ names the flat list of
  check boxes on `#/suche` gets long. Decided: a **search field** above the list, and **groups that each user makes
  for themselves** ("Spieleabend", "Uni-Leute"), chosen with one tap; nobody else sees them. Rejected for now:
  groups shared by everybody. Settled with the owner on 2026-11-08: kept **on the server** (migration 10, tables
  `people_groups` and `people_group_members`; routes `GET/POST /api/groups`, `PATCH/DELETE /api/groups/:id`, types in
  `shared/src/groups.ts`); tapping a group **adds** its people to the current choice; at most **20 groups** per
  person, names **1 to 40 characters**, one name once per person (case ignored), at most 49 other people per group;
  a person whose account is deleted drops out of every group quietly (cascade). Built in `PeoplePicker.svelte`.
  Built and tried on 2026-11-08 in a real (headless) browser against a local test server (screenshots in the README);
  the phone itself is still to check.
- **9b Deleting one's own account** (Opus to plan, Sonnet for the steps). Today only the admin can delete an account.
  Decided: everyone can delete their own account, with its calendar links, devices and settings. Settled with the
  owner on 2026-11-08: the confirmation is the **password again** (route `DELETE /api/me` with `{ password }`, the same
  rate limit as the password change); **polls they created stay** (creator becomes empty, as when the admin deletes an
  account; only the admin manages them), their **votes, calendar links, devices, settings and groups go**; **admins are
  refused** with `cannot_delete_self` (there must always be an admin, and the app never creates one), before the
  password is checked; **every other admin gets an `account_deleted` notification** with the username (no
  notification setting, always on), and migration 11 makes `notifications.poll_id` nullable (keeping the id counter, so
  the Android app never sees an id twice); the calendars' contents are **dropped from the memory cache at once**, also
  when the admin deletes an account. The Android app shows the new text only from the next APK; older apps show the
  general text. `SHELL_VERSION` is not raised. Built in `Profile.svelte` ("Konto löschen" card), the privacy page names
  the new way.
- **9c Better results for large groups** (Opus for the search, Sonnet for the screens). With 15 or more people a
  time when everybody is free is rare, and "Fast alle" shows only times when exactly one person is missing.
  Decided: for larger searches the app shows the **best times with the most people** ("13 von 15 können", with the
  names of who cannot). This revises the rejection of "up to two missing" in phase 3 (long lists): to settle are
  from how many people it applies, how many may be missing, how long the list is and how it is sorted, and that it
  reveals no more than "busy" about anybody (no "Max only from 20:00").
  Settled with the owner on 2026-11-08: the "Fast alle" list allows **a fifth of the readable people** to be missing,
  at least one (3–9 people: 1 as before, 10–14: 2, 15–19: 3, … 50: 10; `partialMaxMissing` in `shared/src/gaps.ts`),
  still only from 3 people; **fewest missing first**, then by date; at most **50 lines** (`PARTIAL_MAX_ROWS`); a line
  reads **"13 von 15 können"** with "ohne dich, Anna und Tim" below. A line is one day (or stretch) and one group of
  missing people, with each time as long as it can be for exactly these people: each of them is busy at some point
  in it, everybody else is free in all of it, so it says no more than "busy" (as the old list did). Built in
  `server/src/gaps/search.ts` (`partialRuns`, new answer field `partial`); the old `nearMisses` (exactly one missing)
  are still sent for apps from before 9c, and the app falls back to them while the server is older. Measured in the
  cloud session: 50 people with 900 events each over a year take about 0.1 s for the whole search.
- **9d Notice to the owner when the server is down** (Opus to plan). Today the owner only notices an outage when
  opening the app. A server that is down cannot report itself, so something outside the home PC has to check it.
  To settle: who checks (recommended to look at first: a scheduled GitHub Actions workflow that calls
  `/api/health`; GitHub e-mails the owner when a run fails, so no new account or service is needed) and its limits
  (GitHub's schedules can start late; the PC is off from 01:00 to 07:00, so the night must not count as an outage;
  how long down before it reports, and not again every hour while it stays down).
  The owner is also considering an **in-app notification** instead of the e-mail and decides when 9d starts. The
  server cannot report its own outage, so then the owner's Android app would have to notice it (its background
  check already asks the server about every 15 minutes) and show a notification itself. That changes the native
  app: a new notification text in `NotificationText.kt` and a higher `SHELL_VERSION`, so everybody is offered an
  app update (the only point of phase 9 that would need one).
  Settled with the owner on 2026-11-08: **e-mail** through a scheduled GitHub Actions workflow
  (`.github/workflows/health.yml`, script `scripts/health-watch.sh`); no in-app notification, so no app update is
  needed. It runs hourly at minute 37. The server counts as down when it does not answer in 3 tries over about
  10 minutes. Night pause 00:55 to 07:30 Berlin time (checked before every try, so a run that slides into the night
  does not report). One mail per outage: the next run looks at the previous run's "Server down marker" step and
  stays green when the outage was reported already; there is no mail when the server is back. GitHub sends the mail
  to whoever created the workflow or last changed its schedule or re-enabled it, so the owner disables and
  re-enables the workflow once under Actions; "Run workflow" with the test alarm tries the mail. The assistant has
  not tried it against the real server (a cloud session cannot reach it); the script is tested with fakes.
  Added on 2026-11-08 with the owner: from day 50 without a change on `main`, the run at 12:37 fails once a day as a reminder (`scripts/inactivity-reminder.sh`), because GitHub switches the schedule off after 60 days.
- **9e A short "So geht's" text to pass on** (Sonnet). A short German text the owner sends to new people together
  with their invite link (e.g. over WhatsApp): what the app is, how to sign up, how to link a calendar. To settle:
  where it lives (recommended: a "Teilen" button next to a new invite in the admin area that sends link and text
  together), and the wording, with the owner.
  Settled with the owner on 2026-11-08 and built (done earlier than planned): the text lives in
  `web/src/lib/invite-text.ts` (`inviteMessage`, WhatsApp bold with `*...*`; the days come from `INVITE_VALID_DAYS`,
  which is **14**, not 7) and the new invite in `InviteCreator.svelte` gets the button "Mit Anleitung teilen"
  (`LinkBox` prop `message`; "Mit Anleitung kopieren" where the browser cannot share). Change the wording in that one
  file. Frontend only; the button "Mit Anleitung kopieren" was seen in a desktop browser (screenshot in the README), the
  phone's share sheet is not tried by the assistant: check it on the phone.
- **9f Load test of the home server** (Opus), **planned for the week from 2026-11-09**; not urgent at 10–15 users.
  The VM has 1 GB of memory; a search reads every chosen person's calendars fresh (up to 400 days ahead, at most 8
  at a time) and the reading of a calendar runs in one piece, so other requests wait meanwhile. Measure with
  made-up but realistically large calendars (50 people, 100+ calendars): how long a first search takes, how much
  memory it needs, and how long other requests wait during it. Only then decide whether anything has to change
  (fewer days ahead, splitting the work, more memory for the VM, the limit of 50 people per search).
  Measured on 2026-11-09 in the cloud session (`scripts/load-test`, README there): the real server with a heap limit of
  512 MB (Node's own choice on 1 GB), 50 people, 130 calendars, the calendar services made up with 0.3–1.5 s per
  answer. **Found and fixed:** every cached calendar kept its whole feed text in memory, because the titles were
  slices of it (V8 keeps the whole string while a slice lives); with calendars near the 10 MB limit the server ran out
  of memory while the calendars were being linked, before any search. Titles and names are now copied
  (`ownCopy` in `server/src/calendars/ics.ts`, test `calendar-ics-memory.test.ts`). Results with the fix, on Node 24
  (as in the Docker image; Node 22 needs less, e.g. 226 MB instead of 318 MB at the highest in the realistic case):

  | Case (search for all 50 over a year)       | realistic: 107 MB of calendars | heavy: 770 MB (9.5 MB per calendar) |
  | ------------------------------------------ | ------------------------------ | ----------------------------------- |
  | First search (empty memory)                | 19 s                           | 51 s                                |
  | Same search again (within 15 minutes)      | 0.1 s                          | 0.1 s                               |
  | Server memory at the highest (RSS)         | 318 MB (before the fix 440 MB) | 600 MB (before: crashed)            |
  | JavaScript heap at the highest / limit     | 135 / 512 MB (before 230)      | 278 / 512 MB                        |
  | Others' requests waited at most            | 0.5 s                          | 2.9 s                               |
  | Three groups of 17 at once                 | waited 0.9 s, RSS 323 MB       | waited 3.6 s, RSS 703 MB, 3 people left out (calendar reads ran into the 20 s timeout) |

  The VM, read by the owner on 2026-11-09: 901 MB of memory, 436 MB available with the server running (`free -m`),
  547 MB swap; the idle server uses 64 MB (`docker stats`); Node's heap limit there is 499 MB, so the test's 512 MB
  matched. A realistic search needs about 210–220 MB more than the idle server (the test's idle server had 105 MB):
  it fits. The heavy case needs 500–600 MB more: more than is free, so the VM would swap and become slow (not
  expected to crash, the heap stays far below its limit). Real calendars of the circle are far smaller than that.
  Not measured: the VM's CPU, and how fast the real calendar services answer (the first search's duration is mostly
  waiting for them, 8 calendars at a time).
  **Decided** by the owner (2026-11-09, on the assistant's recommendation): nothing else changes for now (no worker
  thread, no more parallel reads, the 10 MB limit and the VM's memory stay). The Node 24 figures for the heavy case
  came after that decision and were reported to the owner. If calendars get very large: fewer reads at a time
  (`MAX_CONCURRENT_READS` in `server/src/calendars/busy.ts`) or more memory for the VM. Rerun the load test (with
  Node 24) when calendars or the circle grow a lot, or after changes to reading, caching or the search.
  **Follow-up, size warning** (decided with the owner on 2026-11-09, variant "B" of four: admin page only, admin page
  plus notification, a CLI command, a lower 10 MB limit): the server stores each calendar's size in bytes after every
  successful read (migration 12: `calendars.size_bytes`, `size_warned`; nothing of the contents), in
  `server/src/calendars/size.ts`. Every admin gets a notification **once** when a calendar passes **5 MB**
  (`calendar_large`, with the owner's username and the size) or all calendars together pass **300 MB**
  (`calendars_large_total`); it is armed again only after the size was below the limit. No setting (like
  `account_deleted`); the calendar's owner gets no notification (owner's choice: the hint on their page is enough,
  and the admin talks to them). The owner of a calendar sees each calendar's size on the calendar page and a hint
  under one over 5 MB; the admin page card "Kalendergröße" shows the total and the names of people with a calendar
  over 5 MB, not which calendar. The Android app has the texts from its next APK (`SHELL_VERSION` not raised).
  Measured on the VM on 2026-11-09 after a search for everybody over a year: 135 MB for the server, so far below.

**Release:** 9a–9e are merged and the documentation and screenshots are updated (2026-11-08); the owner wants to release
**1.9.0** (decided 2026-11-07). 9f is a measurement;
it goes into 1.9.0 only if it is done by then and changes something. The assistant suggests the release when 9e is
merged; as always, nothing is released without the owner's word.

Left as they are for now (owner, 2026-11-07), to be raised again when the circle grows:

- **Who may invite** stays the admin alone (and password resets too). Options for later: trusted members may make
  invite links without other admin rights (recommended then), or members suggest a person and the admin confirms.
- **Who can be searched with** stays everybody with an account (phase 3). Options for later: a setting "only people
  from my groups may choose me" (builds on 9a), or saying it more clearly on the privacy page.

### Learning from Timeful (phase 10)

Decided with the owner on 2026-11-11, after comparing the Lückenfüller with Timeful (github.com/schej-it/timeful, an
open source When2meet-style availability poll, read in its source on 2026-11-11). The owner keeps the Lückenfüller and
takes over the ideas below. Each point is its own branch and pull request; points marked "to settle" are agreed with
the owner (choices with a recommendation, a preview mock-up where something is visible) **before** building.

- **10a "Nochmal planen"** (done; Sonnet; web app only). A button on a poll's page (creator and admin) opens `#/suche` with the
  same people and, for an hours poll, the duration of its first proposal; title and note are carried over to
  `#/abstimmung-neu`. Handed over in memory only, like the search choice today (a reload starts empty). The old
  proposals are not copied: they lie in the past, and a poll is deleted 30 days after its last proposal. No server
  change. Rejected for now: stored search templates ("Spieleabend: Samstag ab 18 Uhr, 5 Stunden"), which would need a
  server change; to revisit if the button is not enough.
- **10b Hidden votes** (done; Opus to plan, Sonnet for the steps; server and app). An option when creating a poll: everyone
  else sees **only the sums** per proposal ("5 Ja, 2 Vielleicht"), who has not voted yet, and their own vote; the
  **creator alone** sees every name and answer (admins see only the sums, like everyone else). A hidden poll can be **revealed** later (creator only), never
  hidden again. To settle when building:
  - Backward compatibility: an older server ignores the new field and would create an open poll. The app must only
    offer the option when the server says it supports it (and the server must refuse what it does not know rather than
    create an open poll).
  - The server filters the poll state per caller (never only the app); guests and other accounts get sums.
  - The "someone voted" notification (`vote`) names the voter; for a hidden poll only the creator may get
    the name, the others a notification without it, or none.
  - Migration additive (a new column with a default).

  Built on 2026-11-12: the switch "Stimmen verdecken" (default off) is offered only when `/api/health` lists
  `hidden_votes` in `features`; `POST /api/polls` refuses unknown fields (`validation`), so a later option cannot be
  silently ignored either. The server filters in `buildPollView`: every caller but the creator gets their own vote
  only (a guest by the `X-Vote-Key` header, which the app now also sends on the poll GET), `tally` and
  `votedParticipantIds`. Revealing is `PATCH hidden:false`; hiding an open poll is refused. Notifications (decided with
  the owner): `vote` and `all_voted` name the voter only for the creator, the others get them without a
  name ("Jemand hat abgestimmt."). Not hidden: whether a guest name is already taken in the poll (`vote_name_taken`).
  Changed with the owner on 2026-11-12: admins see only the sums, like everyone else; only the creator sees names,
  reveals and deletes single votes. An admin who is not the creator still manages the poll otherwise (close, deadline,
  fix the date, new link, delete, replan) and gets the filtered view (`canManage` true, `tally` present); revealing or
  deleting a single vote of a hidden poll is refused with `forbidden`, and the notifications carry no name for admins.
- **10c Colour grid** (done; Sonnet; web app only; the bars for hidden polls wait for 10b). Decided with the owner on 2026-11-11 from two preview mock-ups (`docs/mockups/10c-search-grid.jpg`, `docs/mockups/10c-poll-table.jpg`; the poll picture also shows the bars for 10b, variant B):
  - **Search results:** a switch "Liste / Raster" above the results. "Raster" is a **month grid**: each day of the
    search is a square coloured by the best count of that day (shades: all, all but one, all but two, all but three
    or four, fewer; the number or "alle" in the square), with month navigation; days outside the search are grey.
    Tapping a day shows below the grid a **day strip**: the hours of that day coloured the same way, the searched
    window marked (the hours are not tappable: the free times below already name who is missing), and under it
    that day's free times as in the list ("11 von 12 können – ohne Tobias"), each with "Als Termin vorschlagen". Rejected: a separate week grid (with searches over
    several weeks it means much paging; the day strip shows the hours instead) and a switch between week and month.
    The legend is only the colour bar from "weniger" to "alle frei", without a line naming the steps: the squares
    and the day strip carry the number anyway, and the free times below name who is missing.
  - **Poll state:** no switch, the app decides. An open poll shows the people × proposals table with coloured
    cells (green Ja, yellow Vielleicht, grey Nein, dashed for no vote yet) and the "Ja" sums, the best proposal
    marked. A hidden poll (10b) shows the others one bar per proposal (Ja / Vielleicht / Nein, no names); its
    creator and the admin see the table.
- **10d Cinema showtimes, semi-automatic** (Opus to plan, Sonnet for the steps; server and app). The friends often
  plan going to the cinema, which also depends on the showtimes of several cinemas. Decided with the owner on
  2026-11-11: the poll's creator enters, per cinema and day, the showtimes (a text field that takes pasted times such
  as "17:30 20:15 22:45", copied from kinoheld or cineamo, and the browser's own time input for single times, which
  is the round clock on Android), plus the film's length and a buffer for the adverts (suggested 20 minutes). The app
  offers only the showings that fit into a free time of the search, and the poll is made from them. Server changes
  (decided 2026-11-12, see "10d must not change today's use" below): any minute for every proposal, and an optional
  place for every proposal. Backward compatibility: the app offers the cinema mode, the place and minute times only
  when the server says it supports them. Later, in its own session: check whether showtimes can be read automatically.
  A first check on 2026-11-11 could not reach kinoheld.de, cineamo.com or the cinemas' sites (blocked by the cloud
  session's network settings); from search results only (unverified): kinoheld's site uses an undocumented GraphQL
  interface (an unofficial client exists), no official developer access was found, and the commercial International
  Showtimes API is the paid route. Before building on any of it: read the terms of use and robots.txt, and allow the
  hosts for that session. The friends use about ten cinemas in their region; the owner names them in that session
  (deliberately not recorded here: the repository is public, and the list would tell where the friends live).

  **Automatic reading, checked on 2026-11-12 (nothing built; checked twice, the second time more carefully).**
  Seen (a few polite requests, no login):
  - *kinoheld*: its robots.txt blocks AI crawlers completely and lets other bots read most public pages; its terms
    (AGB, point 4.8) forbid robot or spider software and any automated monitoring, copying or processing of the site.
    The site's own script uses a GraphQL server (`next-live.kinoheld.de`) for its own pages; no public developer
    access exists. A cinema's page is `www.kinoheld.de/kino/<city>/<slug>`. Six of the ten cinemas have their own
    page there (checked by that address, not by a name on a city page, which also lists neighbouring towns); one more
    is probably there (slug seen, not opened); for two towns kinoheld has no city page at all. Not usable without
    kinoheld's permission.
  - *cineamo*: lists all ten cinemas. robots.txt allows everything. There are no terms of use (no AGB page, footer
    links only imprint and data protection); the imprint has the usual copyright clause: using content beyond what
    copyright allows, "in particular storing or processing it in databases", needs written consent. Nothing about
    automated access. The cinema pages show the times as text per day. The site reads from an undocumented JSON
    interface: `GET api.cineamo.com/showings?cinemaId=<id>` returned 200 with every showing of a cinema (film name,
    `startDatetime` in UTC, room, language, 3D/OV flags, booking link), 10 per page (one cinema: 353 showings, 36
    pages); `api.cineamo.com/cinemas/<id>` names each cinema's showtime source. No ICS, RSS or JSON-LD screening
    events. Its business site (`b2b.cineamo.com`) offers cinemas a showtimes widget for their own site, nothing for
    third parties.
  - *Where cineamo gets the times*: for one cinema from kinoheld, for one from the cinema's own ticket software, for
    the other eight from "showtime_collector" (cineamo's own collecting; what exactly: not seen).
  - *Cinema sites* (seven of ten found): none has RSS, ICS or JSON-LD screening events on the pages looked at. One
    chain's robots.txt forbids its programme and API paths; one museum site blocks AI crawlers in robots.txt; the
    others allow reading. Booking runs through different systems (the chain's own, kinoheld, a ticket service, a
    museum shop): one data source per cinema would mean up to ten different readers.

  Other providers, checked the same day for a source usable without asking first (none found):
  - *International Showtimes* (Cinepass, Berlin): the only official, documented showtimes API with German cinemas
    (REST/JSON, API key, filters by country); the key comes from a free trial sign-up (seen in their docs). Price
    and trial length not published (a 2024 article names 7 days and about 149 EUR a month: guessed, maybe outdated);
    no terms page found; whether the friends' cinemas are in it cannot be checked without signing up.
  - *kino.de*: no API; robots.txt blocks `/api/` and reserves text and data mining (§ 44b UrhG). *filmstarts.de,
    kinoprogramm.com, programmkino.de*: no API or feed. *moviepilot.de*: terms allow private, non-commercial use, but
    robots.txt blocks its programme pages. *MovieGlu, Gracenote*: business contracts on request only.
  - The cinemas' ticket systems publish no public programme feed (one ticket page looked at: plain HTML). No open data
    for showtimes; Google has no showtimes API.

  Guessed, not seen: the cineamo interface is meant only for their own pages and can change without notice;
  cineamo would probably answer a polite request; kinoheld would grant access only as a business partner.

  Result and recommendation: **technically possible through cineamo, legally not settled; reading each cinema's
  site is too much work and too fragile.** Order: (1) build the semi-automatic entry as decided; (2) the owner asks
  cineamo in writing (contact on `b2b.cineamo.com`) whether a private friends' app may read the showtimes of about
  ten cinemas through `api.cineamo.com`, a few requests a day, with a link back to cineamo for booking; (3) only with
  a yes: the server fetches once a day per cinema (cached in memory like the calendars, via
  `server/src/calendars/fetch.ts`-style guarded requests) and fills the entry field, which stays editable; the cinema
  ids go into the server's settings, not the repository. Without a yes, a button "open on cineamo" next to the entry
  field makes copying quicker. Effort for (3), guessed: about a day's work; it breaks when cineamo changes its
  interface, and the entry by hand stays as the fallback. The paid alternative, if cineamo says no: a trial of
  International Showtimes, first to see whether the cinemas are covered, then the owner decides about the price.
  The request to cineamo was drafted on 2026-11-12 and is sent by the owner (not kept here: it names the cinemas).

  Decided with the owner on 2026-11-12: **no booking in the app**, but a "Tickets" link at a cinema proposal (the
  poll's showings and the chosen date); buying and paying stay with the cinema or its ticket service. The owner
  prefers the **direct ticket link** of the showing, which cineamo's data carries (`onlineTicketUrl`; in the one
  showing looked at it was the cinema's own booking page; the owner looked on cineamo's site and saw it always lead to
  the direct ticket page; in the data itself only that one showing was checked).
  No fallback link (decided by the owner): a showing without a direct ticket link, and every showing entered by
  hand, simply has no link. The address comes from outside data: the app shows only `https` links and opens them
  with `rel="noopener noreferrer"`. The link is part of 10d, not a phase of its own. Where showtimes come from
  cineamo, the app shows a visible credit "Spielzeiten: Cineamo" (decided with the owner on 2026-11-12, also offered
  to cineamo in the request); times entered by hand get no credit.

  **10d must not change today's use** (owner's requirement, 2026-11-12). Besides the usual rules (additive
  migrations, new things offered only when `HealthResponse.features` lists them), points to keep when building.
  Chosen with the owner on 2026-11-12 as general improvements instead of cinema-only exceptions (simpler, fewer
  special cases):
  - *A place for every proposal.* Every proposal gets an optional "Ort" (a cinema, a restaurant, "bei Tom"), shown in
    the poll, at the chosen date and in the calendar feed (`LOCATION`). Without a place everything looks exactly as
    today.
  - *The server takes any minute; the app keeps quarter hours.* The quarter-hour check in
    `server/src/polls/validation.ts` becomes a whole-minute check for all proposals (no flag "this is a showing").
    The app keeps offering quarter hours for normal proposals, so the choice stays short; only the cinema entry and
    typed times allow any minute. To check when building (not checked yet): that the previous server image, after a
    rollback, still reads and shows polls whose proposals are not on a quarter hour (it probably checks only new
    proposals).
  - *Everything that shows proposals copes with minute times and the place*: the poll table, the colour grid (10c),
    the calendar feed, the notification texts in `notification-text.ts` and `NotificationText.kt` (an older Android
    shell must still show a sensible text). Each gets a test where it can be tested automatically.
  - *The automatic fetch (only with cineamo's yes) is optional.* If cineamo is unreachable, slow or answers with
    something unexpected, the entry field simply stays empty for typing by hand; nothing else waits for it or fails
    (no effect on search, polls, health check or start-up). One fetch per cinema a day, outside the hours the home PC
    is off, with a time limit and a size limit; the load test (9f) is rerun once it exists.

Checked and not needed: an "everyone has voted" notification already exists (`all_voted`, phase 6). Not taken over:
filling in free times by hand (the owner doubts friends would do it; guests already vote on the proposals; a lighter
"I am away that day" may come if someone asks), e-mail reminders (no e-mail addresses by design), time zones, CSV
export, sign-up lists, Slack/Discord bots. Direct Google/Outlook login stays in phase 8 (too much work for now).

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
6. **Notifications** (Opus to plan, Sonnet for the steps): 6a server (stored notifications, settings,
   Web Push, reminder), 6b screens (profile card, reminder button, service worker, privacy page).
7. **Android app** (Opus to plan, Sonnet for the steps): 7a server and web app (device key, notification switch
   and share, `.ics` and links through the app), 7b Capacitor shell, background check, signing, APK in the release,
   7c self-update (loads from the latest GitHub release), 7d instant notifications through a Firebase doorbell
   (before release 1.6.0).
8. **Optional later:** direct Google/Outlook connection, offline vote queue.
9. **Growing the circle** (see "Growing the circle" above; model per point there), in this order: 9a own groups in
   the people choice, 9b deleting one's own account, 9c better results for large groups, 9d notice to the owner when
   the server is down, 9e a "So geht's" text to pass on, 9f load test of the home server (week from 2026-11-09);
   then release 1.9.0.
10. **Learning from Timeful** (see "Learning from Timeful" above): 10a "Nochmal planen", 10b hidden votes, 10c colour
    grid, 10d cinema showtimes (semi-automatic).

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

- **Better message while the server sleeps (built 2026-11-02, decided by the owner the same day):** a poll link opened
  between 01:00 and 07:00 shows only "Die Abstimmung kann gerade nicht geladen werden". Plan: a clearer text
  ("Ab 7 Uhr kannst du abstimmen ...") and a button that adds a reminder at 07:00 as a calendar entry (`.ics`
  made in the app). The reminder button was built and then removed on the owner's wish the same day (nobody
  would use it). Built in `web/src/lib/server-night.ts` and `Poll.svelte`: between 01:00 and 06:59 (phone's
  local time) the waiting card shows the new text; at other times the old neutral text. Rejected for now:
  - An offline vote queue: the poll comes from the server, so at night there is no form to fill in. It would
    need the poll kept on the device (names and votes of others stored anew), would not help someone opening a
    link for the first time at night, and needs rules for votes that arrive after the poll changed.
  - A push notification at 07:00: a web page cannot schedule a local notification (Chrome's Notification
    Triggers trial was dropped), so it needs Web Push from the server: a service worker, a new key and library,
    stored subscriptions (personal data of guests), messages through Google/Mozilla/Apple, and on iPhones only
    for the app added to the home screen. Revisit if notifications are wanted elsewhere too (e.g. "Termin steht").
    Notifications came with phase 6 (see "Notifications"); a 07:00 reminder is still not built.
- **Review of the guides (done 2026-11-02):** README and `docs/` were checked against `deploy/vm/*.sh`, the
  units, `setup.sh`, the Dockerfile, `.nvmrc`, `package.json` and the CI files (commands, file names, messages,
  retention numbers, timer times, Node versions): no outdated steps found. Gap found and closed: the trial
  restore is manual by design (the VM never holds the secret key) and `check` does not warn when the newest
  backup is old, so the guide now tells the owner to run `list` first and look at the dates. Now built: the
  backup script writes `data/backup-status` (last backup, last copy to Windows, last trial restore), the server
  gives it to the admin, and the app shows a warning card on the admin's start page and the state in
  "Verwaltung". It warns when the backup or the copy is older than 50 hours, or the trial restore older than
  35 days. It reaches the VM when the owner reruns `setup.sh`.
