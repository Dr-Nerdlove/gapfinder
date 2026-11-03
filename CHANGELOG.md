# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow `vMAJOR.MINOR.PATCH`.

## [Unreleased]

### Changed

- **Server guide: monthly backup check.** The trial restore section now says to run `list` first and look at the dates, because `check` opens the newest backup even if it is old, and that the trial restore cannot run by itself. Documentation only; nothing to do on the VM.
- **Restore names the way back.** If the server does not start after a restore, the message now also gives the command that goes back to the state before. Reaches the VM when `setup.sh` is rerun. The backup test now also covers the maintenance lock, a server that does not come up after a restore, and a wrong Windows password.
- **Server guide corrected.** The password change for the backup user now names the right lines of the script, step 5 warns to check the PC's address with `ipconfig` (a wrong one cuts the SSH window), and the list of files in the VM is complete. `setup.sh` only has two reworded hints (rerun `setup.sh` to get them; nothing else changes).
- **Server VM moves into the home network.** The VM now sits on a Hyper-V external switch, directly in the home
  network like any other device, instead of Hyper-V's "Default Switch". Before, a VPN on the Windows PC
  (NordVPN, even with split tunneling) also carried the VM's traffic, Tailscale's connection dropped every
  minute and the app was unreachable from outside. Now a VPN on the PC no longer affects the server. In the VM,
  SSH from the home network works only from the Windows PC (over Tailscale and at the Hyper-V console it works
  as before), and the backups go to the PC's fixed home-network address, which the setup now asks for. The
  firewall check also proves that the server cannot reach the router. **To do for the owner:** follow "Moving
  the VM from the Default Switch to the home network" in `docs/server-setup.md` and rerun `setup.sh` (changes in
  `deploy/vm/` reach the VM only then). Until then the old VM keeps working as before.

### Added

- "Meine Abstimmungen" now shows the date of a fixed appointment, e.g. "Termin steht: Sa 12.12., 13:00–15:00"
  or "Termin steht: 14.–28. Feb." (same writing as on the poll page). Long dates wrap on narrow phones. While the
  server is not updated yet, the list keeps showing "Termin steht ✓".
- Server part of showing the fixed date in "Meine Abstimmungen": the poll list now also carries the times of the
  fixed proposal (`fixedProposal`, empty while no date is fixed). Nothing changes on screen yet; the app shows the
  date in a follow-up change once the server has updated (up to an hour after the merge).
- Phase 5b, the screens for fixing and sending the date. On a poll's page the creator and the admin get a card
  "Termin festlegen": pick one proposal (the one with the most "Ja" is preselected), the app reads the calendars
  again and warns who is busy, whose calendar cannot be read and who has no calendar (a warning only, fixing
  stays possible, also when the check itself fails), then the date is fixed. Later it can be changed to another
  proposal or taken back. Once a date is fixed, everybody with the link, guests too, sees it highlighted with
  three buttons: download the `.ics` file, "In Google Kalender eintragen" and "In Outlook eintragen" (private
  Outlook accounts; people with a work account use the `.ics` file). The app builds both links itself; for whole-day
  dates Google gets the day after the last day as the end and Outlook the last day. A fixed poll now says "Der Termin steht" instead of "Frist
  abgelaufen". In the profile, "Mein Lückenfüller-Kalender" switches the personal calendar feed on, shows and
  copies its link with short instructions for Google, Apple and Outlook (Google refreshes only every few hours),
  renews the link or switches it off. "Meine Abstimmungen" shows "Termin steht ✓". The buttons appear only once
  the server has the phase 5a update (up to an hour after the app), until then the app behaves as before.
- Phase 5a, fixing the date on the server: the creator or the admin of a poll can fix one date as the final one,
  change it to another date later, or take it back. While a date is fixed the poll takes no more votes (taking
  it back opens the poll again, unless it was closed by hand or its deadline has passed). Before fixing, the
  server can read the participants' calendars again and tell who would be busy, who has no calendar and whose
  calendar cannot be read; it is only a warning and never stops anyone from fixing (it counts like a search
  against the limit of 30 per 15 minutes). Everybody with the poll link, guests too, can download the fixed
  date as a calendar file (`.ics`). Every person with an account can switch on a personal calendar feed with a
  secret link, renew it (the old link stops working) or switch it off; subscribed in a calendar app, it shows
  the fixed date of every poll the person created, takes part in or voted in, except polls where the person
  voted "no" for the fixed date. Old dates disappear with their poll, 30 days after its last date. There are no
  screens yet (phase 5b). The server updates itself; nothing has to be set up again.
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

### Fixed

- "In Outlook eintragen" put whole-day dates in Outlook one day too long (3.-4. Jan. became 3.-5. Jan.); now they
  end on the right day.
