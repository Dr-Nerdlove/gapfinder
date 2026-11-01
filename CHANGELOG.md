# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow `vMAJOR.MINOR.PATCH`.

## [Unreleased]

### Added

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
