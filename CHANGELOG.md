# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow `vMAJOR.MINOR.PATCH`.

## [Unreleased]

### Added

- Phase 4b, polls on screen: in the search result, tap free times to choose them; "Abstimmung anlegen" opens a
  page with title, note, deadline and the exact start and end of each date (suggested: the searched duration
  from the start of the gap). The poll page (`#/abstimmung/<link>`) works for guests and friends: name (guests
  only), yes / maybe / no per date, a table with sums, the best date highlighted and "Noch nicht abgestimmt".
  It refreshes every 30 seconds and keeps showing the last state while the server sleeps (1-7 o'clock). A
  guest's device remembers the vote key. Creator and admin can change the deadline, close and reopen, delete a
  vote, renew the link and delete the poll. New list "Meine Abstimmungen" (`#/abstimmungen`) and a button on
  the start page. The server is unchanged.
- Phase 4a, polls on the server: from the results of a gap search, a person with an account can make a poll
  with 1 to 20 proposed dates (exact times, or whole days from a multi-day search), a title, an optional note
  and an optional deadline. The poll gets a share link: everyone with it sees the state and votes yes / maybe /
  no on every date. Friends vote with their account (marked with a check mark, changeable from any device),
  guests with their name; a guest's device keeps a secret key to change or withdraw the vote later. Guests
  cannot use a friend's username. The creator and the admin can change the deadline, close and reopen the
  poll, remove votes, renew the link (the old one stops working) and delete the poll. A poll is deleted 30 days
  after its last date. Limits against strangers: 20 polls per person, 100 guest votes per poll, 30 guest votes
  per address every 15 minutes, and wrong links are blocked like wrong invite links. There are no screens yet
  (phase 4b). The server updates itself; nothing has to be set up again.
- Phase 3b, gap search screens: a new page "Lücken suchen" (button on the start page). On one page you choose
  the friends, the kind of search (hours on weekdays with a time window and buffer, or several days in a row,
  optionally starting on a weekday) and the range (30 or 90 days, half a year, a year, or whole months). The
  result lists the days when everyone is free, a second list "Fast alle" names the one person who is missing,
  and a notice says who was left out because their calendar is missing or cannot be read. Ten lines are shown
  at a time. The device remembers the last settings (and the chosen friends). While the server sleeps at night
  the settings stay and the search waits. The server is unchanged (it needs the phase 3a image).
- Phase 3a, gap search on the server: a list of everyone with an account (only name and colour) to choose
  whom to search with, and the search itself. The server finds the times when everyone is free, either for a
  given number of hours on chosen weekdays (optionally in a time window, even across midnight, and with a buffer
  before and after every event) or for several free days in a row (optionally starting on a given weekday).
  It also reports "almost everyone" times where exactly one person is missing (from three people on). A person
  with no calendar, or with a calendar that cannot be read completely, is left out and named as such instead of
  counting as free. All times follow German time, including the daylight saving days. Nothing is stored, and the
  answer only contains times, never event titles. A person can run 30 searches every 15 minutes. There are no
  screens yet (phase 3b); **the server image must be updated before they can use it**.
- Phase 2b, calendars: everyone can link their calendars through the subscription link of Google, Apple iCloud
  or Outlook ("Kalender" page). The server tries a new link at once and keeps it only when it works; the link
  is stored encrypted and never shown again, only the provider and the name. Up to 10 calendars per person, one
  of them the default one, and each can be switched to "counts as busy" or not (e.g. a birthday calendar). A
  preview shows your own events of the next 4 weeks (from midnight today), with their titles that only you ever
  see; calendar contents are only kept in the server's memory for 15 minutes and never written to disk or into
  a backup. If a provider says a calendar is gone (e.g. Google's secret address was reset), it is marked
  broken, the start page and the calendar list say so ("Link neu eintragen"), and nothing is deleted; the admin
  only sees a count ("1 Kalender mit Problem"). A calendar without a name is shown under its provider's name.
  Checking links is limited to 20 per person every 15 minutes. **The server image must be updated; the VM
  needs `setup.sh` (phase 2a) first** or the calendars page says they are not set up yet.
- Phase 2a, preparing the server for calendars: a key for storing calendar links encrypted, which every
  nightly backup carries (encrypted with the backup key) and a restore puts back; and a firewall that lets the
  server's container reach only the internet over HTTPS (and two public name servers), never the home network,
  the PC, the VM or Tailscale. The trial restore also checks the calendar key. **The VM needs `setup.sh` once
  more**, then a backup and a trial restore: step 10 in `docs/server-setup.md`. Nothing changes in the app yet.
- Nightly backups of the database: encrypted with the owner's own key, kept in the VM and copied to a folder
  in the owner's OneDrive on the Windows PC. A trial restore checks a backup and the key without changing
  anything, and a restore puts a backup back (and can be undone). Step 9 and "Restoring a backup" in
  `docs/server-setup.md` explain it. **The VM needs `setup.sh` once more** (see "When the files in `deploy/vm/`
  change"), then `sudo lueckenfueller-backup setup`.

- Phase 1c, accounts:
  - Friends join through a personal invite link from the admin. The link works once and for 14 days, and it
    already suggests the username (e.g. "Vincent R."); username and password are chosen by the person.
  - Login with username and password. The login stays on the device for half a year after it was last used.
  - Profile: change the username, the password and the app's colour (8 colours or an own one), log out.
    Changing the password logs out the other devices.
  - Admin area ("Verwaltung"): create and withdraw invite links, rename and delete accounts, and create a
    link for a forgotten password (works once and for 24 hours; the person chooses the new password).
  - The first admin account is created with a command in the VM; the guide (`docs/server-setup.md`) explains
    it, and also what to do when the admin forgets their own password. Nothing has to be changed in the VM
    otherwise; `setup.sh` does not need to run again.
  - Protection against guessing: passwords are stored only as Argon2 hashes, too many wrong attempts are
    blocked for 15 minutes, and links with secret codes never appear in the server's log.
- Phase 1b, the home server:
  - A step-by-step guide for running the server in its own small Linux VM on the home PC, reachable from the
    internet only through Tailscale Funnel, with nothing opened on the router (`docs/server-setup.md`).
  - A setup script that installs everything in the VM in one go.
  - The server updates itself about once an hour. If a new version does not start properly, it goes back to
    the previous version by itself. Debian, Docker and Tailscale install their security updates automatically.
- Phase 1a, the foundation of the app:
  - A first version of the app that opens on the start page and shows whether the server is reachable. When the
    server is off (nightly from 1 to 7 o'clock), it says "Lückenfüller schläft gerade" and offers to try again.
  - The look follows Material 3 and the phone's light or dark mode, and the app can be installed to the home
    screen.
  - The server with a health check, a small SQLite database that updates its own structure at start, strict
    settings for which websites may talk to it, and a Docker image for the home server.
  - Automatic checks and tests on every change, automatic publishing of the app to GitHub Pages and of the
    server image to the GitHub container registry.
