# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow `vMAJOR.MINOR.PATCH`.

## [Unreleased]

## [2.1.1] - 2026-11-09

The server needs far less memory after a search: it used to keep the whole text of every calendar it had read, now
only what the search needs, so even very large calendars no longer make it run out of memory. The round "?" help
symbols are a little smaller. Nothing changes in how you install or update; the server updates itself within about
an hour, and the Android app needs no new installation.

### Changed

- The round question-mark help symbol is a little smaller (the tap area stays 44 px).

### Fixed

- The server needs far less memory for the calendars it keeps for 15 minutes after a search: it used to keep each
  calendar's whole text, now only the times and titles it needs. A search for 50 people with very large calendars
  no longer makes the server run out of memory and restart.

## [2.1.0] - 2026-11-09

The start page now suggests installing Lückenfüller on your phone. On the iPhone and iPad it explains how to put it on
the home screen, which is also what makes notifications possible there; on Android it offers the Android app. Tap
"Nicht mehr zeigen" to hide the hint on that device. Nothing changes in how you install or update, and the Android app
needs no new installation.

### Added

- The start page now suggests installing Lückenfüller: on the iPhone and iPad how to put it on the home screen, on Android a button to download the Android app. "Nicht mehr zeigen" hides the hint on that device.

## [2.0.0] - 2026-11-09

Small "?" buttons next to eleven features now explain them in a short window: when a calendar counts as busy, the
preview of your next 4 weeks, your Lückenfüller calendar, the kinds of search, buffer and time window, the "Fast alle"
and "Nicht berücksichtigt" results, how votes are counted, fixing a date and who can vote with a poll's link. Releases
now carry only one Android APK, the one with the version number in its name. Version 2.0.0 simply follows 1.9.0 (the
version numbers stay below 10); nothing changes in how you install or update, and the Android app needs no new
installation.

### Changed

- Releases now carry only one APK, the one with the version number in its name. The "Android-App herunterladen" button in the browser links to the APK of the current version.

### Added

- Small „?“ buttons next to eleven features (calendar settings, preview and calendar feed, search options, search results, poll results, fixing a date and sharing a poll) explain the feature in a short window.

## [1.9.0] - 2026-11-08

Lückenfüller is ready for a bigger circle of friends. On the search page you can find people with a search field and
keep your own groups ("Spieleabend", "Uni-Leute") that add their people with one tap. With many people, the search now
also shows the best times when only a few cannot ("13 von 15 können", with the names of those who cannot). The poll
page names the people whose calendar was not considered and tells you, per proposal, whether you are free or busy
according to your own calendar. Everyone can delete their own account in the profile, and a new invite comes with a
ready "So geht's" text for WhatsApp. The owner now gets an e-mail when the server has been unreachable for about
10 minutes. The server changes only add things, so the app also works with a server that is not updated yet; the
Android app shows the new notification text for deleted accounts from the next APK.

### Added

- On the poll page, the calendars are now checked once when the page opens. Everyone with the link (guests too) sees the same **"Nicht berücksichtigt"** card as in the search for participants who have no calendar or whose calendar cannot be read, and a logged-in person sees under each proposal in the vote form whether they are **free or busy according to their own calendar** (and a clear note when they chose "Ja" for a busy time). Votes are never changed automatically. New server route `GET /api/poll-links/:shareToken/calendar-check` (own limit of 60 calls per 15 minutes; it returns only reasons and yes/no answers, never titles or times, and the contents of calendars stay in memory). The server change is additive; until the server is updated, the app simply shows nothing extra.

- On the search page, a search field above the list of people and **own groups** ("Spieleabend", "Uni-Leute"): save the current choice as a group, tap a group to add its people to the choice, replace a group's people with the current choice, or delete it. Groups are private (nobody else sees them), kept on the server (the same on every device and in the Android app), at most 20 per person with names up to 40 characters. A person whose account is deleted drops out of every group quietly. The server change is additive (two new tables).

- Everyone can now **delete their own account** in the profile ("Konto löschen", with the password as confirmation). The account, its calendar links, devices, groups, settings and votes are deleted; polls the person created stay until they expire and can then only be managed by the admin. Every admin gets a notification with the username (always on, no setting), and the contents of the person's calendars are forgotten at once. Admins cannot delete their own account in the app. The privacy page explains it. The server change is additive (the notifications table can now hold entries without a poll). The Android app shows the new notification text from the next APK; older apps show a general text.

- In the administration, a new invite link now comes with a **"So geht's" text** for new people (what the app is, sign-up, linking a calendar, privacy, the night break). The button "Mit Anleitung teilen" (or "Mit Anleitung kopieren" where the phone offers no sharing) sends the text and the personal link together, e.g. over WhatsApp. Frontend only.

- The owner now gets an e-mail from GitHub when the server has not been reachable for about 10 minutes. A scheduled check runs every hour, not at night between 00:55 and 07:30, and sends one mail per outage (none when the server is back). Nothing changes for other users and nothing on the VM. From 50 days without any change, a daily reminder mail asks for a small change, because GitHub would switch the check off after 60 days.

### Changed

- **Better results for larger groups:** the "Fast alle" list on the search page now also shows times when more than one person cannot, up to a fifth of the people (with 15 people up to 3, with 50 up to 10; below 10 people it stays at one). The best times come first: those with the fewest people missing, then by date, at most 50 lines. Each line says "13 von 15 können" and, below, who cannot ("ohne dich, Anna und Tim"); nobody learns more about anyone than that they are busy at some point in that time. Until the server is updated, the app shows the list as before.
- When the admin deletes an account, the server now also forgets that person's calendar contents from memory at once instead of after up to 15 minutes.
- Buttons that were plain coloured text now have an outline so they are recognisable as buttons; in the admin's account list the three buttons per account sit in one row (on very narrow screens the third moves to a second row).

## [1.8.1] - 2026-11-06

The app is tidier: server details that only matter to the admin are no longer shown to everyone. The start page shows
just the version at the bottom, and the server's state is now in a "Server" card in the administration. The profile
no longer has the "App-Version" box, the notification settings in the Android app are simpler, and the night message
"Lückenfüller schläft gerade" appears only once per page. Nobody needs to do anything: the app updates itself.

### Changed

- The start page no longer shows server details to everyone. It shows only the version of the app at the bottom, and
  the "Lückenfüller schläft gerade" card when the server is not reachable. The details (server reachable, up to date,
  app and server build) moved to a new "Server" card in the administration.
- The profile no longer has the "App-Version" box; the update card on the start page stays.
- On the Android app, the notification lines about instant delivery and the last check are shown to the admin only,
  and the button "Jetzt nachsehen" is gone (the app still looks for news by itself when it is opened).
- The message that the server sleeps from 1 to 7 o'clock now appears only once per page: the profile and the poll
  page no longer repeat it in their cards.

## [1.8.0] - 2026-11-06

Getting the Android app is now one tap. The button "Android-App herunterladen" downloads the newest app directly
instead of opening the release page; open the downloaded file and Android asks whether to install it. Whoever has
the app already needs to do nothing: the change is in the web app, which every app loads anew.

### Changed

- The button "Android-App herunterladen" now downloads the newest Android app directly instead of opening the
  release page; the notes next to it say so. Every release now also carries the APK under the fixed name
  `lueckenfueller.apk` for this link.

## [1.7.1] - 2026-11-06

Fixes for the Android app. The Back gesture now goes to the previous page and leaves the app only from the start
page. Scrolled content no longer slides behind the status bar, and the notification card notices when notifications
are switched off in Android's settings. The app offers this version as an update: tap "Aktualisieren" on the start
page. In the browser on an Android phone, Lückenfüller now points to the Android app, also when the browser blocks
notifications.

### Changed

- Notification settings on an Android phone in the browser: when the browser blocks notifications, the card now
  points to the Android app as the easiest way to get them, with the download button as the main step, instead of
  browser settings that often do not help on the phone; the app-info steps appear only when Lückenfüller was opened
  from the home screen.
- Android phones in the browser now see a note that Lückenfüller also exists as an Android app, with a link to the
  release page.

### Fixed

- Android app: the Back gesture now goes to the previous page, step by step back to the start page, and leaves
  the app only from there; before, it closed the app on every page. The app offers this as an update.
- Android app: scrolled content no longer slides behind the clock and icons of the status bar at the top; the bar of
  the gap search stays above Android's gesture bar at the bottom.
- Android app: when notifications are switched off in Android's settings after they were turned on, the notification
  card now says so and tells where to allow them again, instead of claiming they arrive instantly. Coming back from
  the settings, the card reads the new state by itself.
- The privacy page no longer calls the Android app "later": notifications are kept 7 days so the app can fetch them.

## [1.7.0] - 2026-11-05

The Android app can now update itself. If you have version 1.6.0, install the APK of this release once by hand from
the release page; after that the app updates itself: the start page shows "Neue App-Version" with a button
"Aktualisieren", and Android asks you to confirm. The profile shows whether the app is up to date.

### Added

- The Android app can update itself: when a new release brings a new app shell, the start page shows a card
  "Neue App-Version" with a button "Aktualisieren"; the app downloads the update, checks that it is the real
  Lückenfüller (checksum, signature, version) and Android asks you to confirm. The profile shows whether the app is up to
  date. Every release now carries `app-update.json` for this. The app from 1.6.0 cannot do this yet: install the new
  version once by hand from the release page, then updates come by themselves.
- The privacy page says that the app asks GitHub once per start whether a new version exists.

## [1.6.0] - 2026-11-05

Lückenfüller is now also an Android app. Download the APK from this release page and install it; a newer APK later
replaces it and the login stays. The app shows the same pages as the browser, wears your phone's colours on Android 12
and newer (switch "Farben vom Handy übernehmen" in the profile), and shares, downloads the .ics file and opens calendar
links with the phone's own functions. Notifications in the app arrive at once: the server only rings the phone
through Google's Firebase, without any content, and the app then fetches the news from your own server. As a backup
the app also looks for news about every 15 minutes and whenever it is opened. The notifications card shows when it
last looked, with the buttons "Jetzt nachsehen" and "Test-Benachrichtigung". The admin page shows whether instant
notifications are ready, and the privacy page explains what Firebase receives. Also new: proposals and deadlines are
offered in half-hour steps, and the red and pink profile colours are gone (a saved colour stays). The web app
updates about 2 minutes after the release. On the VM, rerun `setup.sh` once to add the Firebase key (guide:
`docs/server-setup.md`, step 11); without it the app checks every 15 minutes.

### Added

- Instant notifications for the Android app: once the owner has set up Firebase (guide: `docs/firebase-setup.md`),
  the server rings the phone the moment news arises and the app looks at once. Google learns only that a phone
  should look, never what about. The check every 15 minutes stays as a backup (phones without Google services, a
  lost ring, the server asleep at night). Phones that already have notifications on switch to the instant way by
  themselves after the update.
- The admin page shows whether instant notifications are ready and how many phones can be rung.
- The privacy page explains what Firebase receives (a phone's token, no content).
- Changes to `deploy/vm/` (`setup.sh` now asks for the Firebase key) reach the VM only when `setup.sh` is run again.

- An Android app: install it from the APK on the GitHub release page. It shows the same app as the browser and
  tells you about new polls, votes and fixed dates with notifications (checked about every 15 minutes, not at night
  while the server sleeps). An installed version is replaced by a newer APK and the login stays. On Android 12 and
  newer it wears the colours of your phone (Material You) so it matches your other apps; a switch in the profile
  ("Farben vom Handy übernehmen") turns that off and brings back your own profile colour. In the browser nothing
  changes. The notifications card in the app shows when the background check last looked for news, how it went and
  how many notifications it showed. Two buttons next to it, "Jetzt nachsehen" and "Test-Benachrichtigung", let you check at once whether news is waiting and whether Android shows notifications; the app
  also looks for news whenever you open it. A notification that Android blocks is no longer counted as shown: it is kept
  and delivered once Android allows it.

- Groundwork on the server for the Android app's notifications: each phone gets its own key, which can only read that
  person's notifications. It is removed when the app switches notifications off, at a password change, and after 90
  days without use.
- The web app is prepared for the Android app: inside it, the notifications switch, sharing, the .ics file and links to
  other sites use the phone's own functions. In the browser nothing changes.

### Changed

- Profile colour: the two red presets (red and pink) are gone, as they were too close to orange. A colour that is
  already saved stays as it is, and "Eigene Farbe" still allows any colour.
- Creating a poll: start and end of a proposal are offered in half-hour steps, plus the start and the end of the free
  time itself (so a free time from 14:15 can still be used completely). The deadline time of a poll is offered in
  half hours as well. The server still accepts quarter hours, so existing polls are not affected.

## [1.5.1] - 2026-11-04

The gap search has shorter, clearer lists: "Mindestens" offers whole hours, and the buffer and the time window
("Zeitfenster von" and "bis") offer half hours. Settings saved on a phone are adjusted to the new steps the next time
the search is opened. The Back button now works as expected: "← Start" goes back to the start page, and on the start
page Back leaves the app. The app updates about 2 minutes after the release. Nothing has to be done on the VM.

### Changed

- **Time window in half hours.** "Zeitfenster von" and "bis" in the gap search now offer half-hour steps instead of
  quarter hours. A quarter-hour window saved on a device is widened to the half hours around it (18:15–22:45
  becomes 18:00–23:00).
- **Buffer in half hours.** "Puffer vor und nach Terminen" in the gap search now offers half-hour steps (none,
  30 minutes, 1 hour ... 2 hours) instead of quarter hours. A quarter-hour value saved on a device is rounded up to
  the next half hour.
- **"Mindestens" in whole hours.** The minimum length in the gap search now offers only full hours (1 hour, 2 hours,
  3 hours ...) instead of half-hour steps. A half-hour value saved on a device is rounded up to the next full hour.

### Fixed

- **Back works as expected.** "← Start" now steps back to the start page instead of adding a new step, and
  redirects (after logging out, creating or deleting a poll, accepting an invite) replace the page they come from. On
  the start page, Back now leaves the app instead of reopening an earlier menu.

## [1.5.0] - 2026-11-04

The app is easier to read and use: the start page is now tidy, with "Lücken suchen" on top and the other places listed
below it as a menu. Admins find "Verwaltung" in its own section. Chosen options, such as weekdays or the answers when
voting, are filled in the app's main colour and show a check mark, and other buttons have a light border, so all of
them are easy to see in dark mode too. In the gap search, the fields side by side now line up. The app updates about
2 minutes after the release. Nothing has to be done on the VM.

### Changed

- **Tidier start page.** "Lücken suchen" now spans the whole width, and the other places (Meine Abstimmungen,
  Kalender, Profil, Einführung) are listed below it as a menu with an arrow. Admins find "Verwaltung" in its own
  section "Nur für Admins".
- **Secondary buttons are easier to see.** Buttons such as "Abmelden" or "Erneut versuchen" now have a light border,
  also in dark mode.
- **Selected buttons are easier to see.** Chosen options (for example "Stunden", weekdays, "30 Tage", and the answers
  when voting) are now filled in the app's main colour and show a check mark, also in dark mode.

### Fixed

- **Fields side by side line up.** In the gap search, the "Mindestens" field now sits at the same height as the
  "Puffer vor und nach Terminen" field, and the short label is centred next to the two-line one.

## [1.4.0] - 2026-11-04

The app can now send notifications: about a new poll, new votes, when everyone has voted, when the date is fixed, and
reminders, even when the app is closed. They are switched on or off for each device in the profile, under
"Benachrichtigungen". The creator of a poll can also remind those who have not voted yet with "Erinnerung senden". On
an iPhone, notifications only work when the app was added to the home screen. The app updates about 2 minutes after
the release, notifications work once the server has updated itself, within about an hour. Nothing has to be done on
the VM.

### Added

- **Notifications.** The app can now tell you about a new poll, new votes, when everyone has voted, when the date is
  fixed, and reminders, even when the app is closed. In the profile, the new card "Benachrichtigungen" switches them
  on or off for each device (the browser asks for permission once) and has one switch for each kind of message.
  Tapping a message opens the poll. On an iPhone this only works when the app was added to the home screen (iOS 16.4
  or newer); the card says so. If the browser blocks notifications, the card explains how to allow them again.
- **"Erinnerung senden" on the poll page.** The creator can remind those who have not voted yet. The button is
  hidden once the date is fixed, the poll is closed or everyone has voted, it shows when the last reminder went out,
  and a reminder can be sent at most once every 24 hours.
- **Logging out switches the device off.** The device is removed from the notifications on the server and in the
  browser, so nothing is shown after logout.
- **Privacy page.** It now says what is stored for notifications (the device registration, the settings, and the
  notifications themselves for 7 days) and that messages travel encrypted through the browser's push service.
- **Server groundwork.** The server creates the notifications and sends them by Web Push; a list for the later
  Android app is prepared as well.

### Fixed

- **No double message when the last person votes.** The creator now gets only "Alle haben abgestimmt", which names
  who voted last, instead of that message plus "hat abgestimmt". Whoever has switched "Alle haben abgestimmt" off
  still gets the normal vote message.
- **Android status bar.** The small symbol in the status bar now shows the Lückenfüller symbol (the two blocks with
  the bar in the gap) instead of a white square. iPhones always show the app icon there.

Notifications work once the server has updated itself, within about an hour. Nothing has to be done on the VM. The
vote fix works once the server has updated itself; the new status bar symbol once the app is reloaded.

## [1.3.1] - 2026-11-04

Small fixes: the subscribed "Lückenfüller" calendar now shows German time as its time zone instead of UTC (the
times of the events were already right). The colour dots next to the friends in "Wer kommt mit?" are gone, and the
own colour in the profile is shown as a filled circle. The app updates about 2 minutes after the release, the
calendar time zone once the server has updated itself, within about an hour. Nothing has to be done on the VM.

### Fixed

- **Calendar subscription shows German time.** The "Lückenfüller" calendar feed now names Europe/Berlin as its time
  zone, so apps like Google Calendar no longer show it as UTC. The times of the events were already right and do not
  change.
- **Own colour in the profile is a filled circle** instead of a square inside a circle.

### Changed

- **No colour dots in "Wer kommt mit?".** The dots only repeated each friend's profile colour and had no meaning in
  the search, so they are gone.

## [1.3.0] - 2026-11-04

New users now get a short guided tour on the start page after their first login on a device; it can be opened
again at any time with "Einführung". A new privacy page explains in plain words what happens with a calendar and who
can see what, and the guide for adding a calendar is simpler: it first asks which calendar you use and then shows
short steps for phone and computer. In the search for whole days, short appointments no longer block a day: only
all-day events and events of at least 6 hours count, also in the check before fixing a whole-day poll date. The app
updates about 2 minutes after the release; the new rule for whole days takes effect once the server has updated
itself, within about an hour. Nothing has to be done on the VM.

### Added

- **Guided tour for new users.** It opens once on the start page after the first login on a device, and can be
  opened again at any time with "Einführung" on the start page.
- **Privacy page** (`#/privatsphaere`) that explains in plain words what happens with a calendar and who can see
  what. It is open to everyone, guests included.

### Changed

- **Simpler guide for adding a calendar.** It first asks which calendar you use and then shows short steps for
  phone and computer. Google's setting is now named "Kalender integrieren" and works in the phone's browser.
- **Short appointments no longer block a whole day.** In the search for whole days, only all-day events and
  events of at least 6 hours make a day busy, so a dentist appointment no longer blocks a holiday. The same goes
  for the check before fixing a whole-day poll date.

## [1.2.0] - 2026-11-03

Each calendar can now count as busy separately for the two kinds of search: "Stunden" and "Ganze Tage". For
example, a work calendar can block weekday evenings without blocking a holiday. The check before fixing a poll's
date uses the matching switch too. Existing settings carry over to both switches, so nothing changes until someone
switches one. The search choices are now called "Stunden" and "Ganze Tage", and sharing a link on Android shows
Lückenfüller's own icon again. The app updates about 2 minutes after the release; the server updates itself within
about an hour, and until then only the "Stunden" switch is shown. Nothing has to be done on the VM.

### Added

- **Busy setting per kind of search.** Each calendar can now count as busy separately for searches by hours and
  by whole days (for example a work calendar that should block weekday evenings but not a holiday). Existing
  settings carry over to both.

### Changed

- The search choices are now called "Stunden" and "Ganze Tage".

### Fixed

- **The app's own icon when sharing a link.** The share sheet on Android showed the icon of another website on the
  same address (github.io) instead of Lückenfüller's, because the app only offered its icon as SVG, which Chrome
  on Android cannot use there. The app now also offers it as PNG.

## [1.1.0] - 2026-11-03

Usernames are now set by the admin and stay that way. When inviting someone, the admin types the exact username
(for example "Max", or "Samuel Kr." when several friends share a first name); the app refuses a name that an
account or an open invite already has. Invited people see their username and only choose a password, and nobody can
change their own username in the profile any more; only the admin renames accounts. Existing accounts keep their
names and log in as before. The server updates itself within about an hour; until then it still shortens a typed
name to first name plus initial, so wait with invites that need more letters. Nothing has to be done on the VM.

### Changed

- **Usernames are fixed by the admin.** The admin types the exact username when inviting someone (e.g. "Samuel
  Kr."); a name that a user or an open invite already has is refused. Invited people see their username but can no
  longer choose it, and nobody can change their own username in the profile any more; only the admin renames
  users. `admin-link` takes the exact username too. Older app versions keep working with the server.

### Added

- **GitHub releases are made automatically.** When a change on `main` carries a new version number (the release
  pull request), a workflow sets the tag (once the deploy has finished green) `vX.Y.Z` and creates the GitHub release, with the summary from this file
  as its notes (each paragraph on one line, so the text does not break mid-sentence on GitHub). Nothing changes in the app or on the server. This also makes the missing release `v1.0.0`.

## [1.0.0] - 2026-11-03

The first release. Lückenfüller is a mobile-first web app for a group of friends: everyone links their calendars,
the app finds the times when everybody is free, everyone votes on the proposals, and the chosen date goes to
everyone's calendar.

**How to use it.** The admin creates an invite link for each friend. A friend opens the link, picks a username and
a password, links a calendar through its subscription link (Google, Apple, Outlook and others) and is ready.
To find a date, choose people, a period and a duration; the app shows when everyone, or almost everyone, is free.
Pick some of those times as proposals and share one link: everybody who has it, guests too, votes with
Ja / Vielleicht / Nein. The creator (or the admin) fixes one proposal, and everybody can add it to their calendar.
All text in the app is German.

**How the server is updated.** The app (GitHub Pages) updates itself right after every change on `main`. The
server runs in a small Linux VM on the home PC, looks for a new version about once an hour and installs it
by itself; if the new version does not start properly, it goes back to the previous one. The start page shows the
release number and whether the server has the same state as the app. Changes in `deploy/vm/` reach the VM only
when `setup.sh` is rerun (the entries below say when). The server is off at night from 1 to 7 o'clock; the
app then says so. Nothing has to be done on the VM for 1.0.0 itself.

The list below is everything built so far, newest first.

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

- **The start page shows the release number and whether the server is up to date.** "Server erreichbar" now says
  "Version 1.0.0" and, in words, "Der Server ist auf dem neuesten Stand." or "Der Server wird gerade aktualisiert."
  (the app is updated at once, the server within an hour). The commit stays visible in small letters ("Stand
  sha-…"). Only the app changes; the server and the VM stay as they are, and an older app build or a local
  development build shows no hint.
- **The app warns the admin when the backup has stopped.** The start page (admin only) shows the card "Sicherung prüfen" when the last backup or the last copy to Windows is more than 50 hours old, or the monthly trial restore is more than 35 days ago. "Verwaltung" has a new card "Sicherung" with the three times (backup, copy to Windows, trial restore). The backup script writes a small status file (`data/backup-status`) that the server shows to the admin. **Reaches the VM only when the owner reruns `setup.sh`**; until then the card says the state of the backup is unknown. The frontend copes with a server that does not know the new route yet (it shows nothing).
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
