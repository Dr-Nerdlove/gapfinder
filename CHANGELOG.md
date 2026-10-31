# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow `vMAJOR.MINOR.PATCH`.

## [Unreleased]

### Added

- Phase 1a, the foundation of the app:
  - A first version of the app that opens on the start page and shows whether the server is reachable. When the
    server is off (nightly from 1 to 7 o'clock), it says "Lückenfüller schläft gerade" and offers to try again.
  - The look follows Material 3 and the phone's light or dark mode, and the app can be installed to the home
    screen.
  - The server with a health check, a small SQLite database that updates its own structure at start, strict
    settings for which websites may talk to it, and a Docker image for the home server.
  - Automatic checks and tests on every change, automatic publishing of the app to GitHub Pages and of the
    server image to the GitHub container registry.
