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
    nothing fits everyone, and "Max only from 20:00" hints (reveal more of someone's day).
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
    and `GET/POST/DELETE /api/me/calendar-feed`, `GET /api/calendar-feeds/:token` in `server/src/routes/feeds.ts`;
    the calendar file writer is `server/src/calendars/ics-write.ts`, the shared calendar reading
    `server/src/calendars/busy.ts`, the feed contents `server/src/polls/feed.ts`. A wrong feed token is not
    counted in the per-address bucket (calendar services share addresses; the token cannot be guessed).
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
    - Inside the app, "Teilen", ".ics herunterladen" and links to other sites (Google/Outlook, `webcal://`)
      go through the Android app (`web/src/lib/native.ts`), because the Android web view cannot share, download
      or open other apps on its own. In the browser nothing changes.

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
6. **Notifications** (Opus to plan, Sonnet for the steps): 6a server (stored notifications, settings,
   Web Push, reminder), 6b screens (profile card, reminder button, service worker, privacy page).
7. **Android app** (Opus to plan, Sonnet for the steps): 7a server and web app (device key, notification switch
   and share, `.ics` and links through the app), 7b Capacitor shell, background check, signing, APK in the release,
   7c self-update (loads from the latest GitHub release).
8. **Optional later:** direct Google/Outlook connection, offline vote queue.

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
