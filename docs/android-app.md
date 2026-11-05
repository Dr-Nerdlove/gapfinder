# Android app

The Android app is a thin shell around the web app, made with [Capacitor](https://capacitorjs.com/) (project in
`android/`, Kotlin for the native parts). It loads the live app from GitHub Pages, so it is always as current as the
browser version, and it adds what a web page cannot do on Android: notifications from a background check, sharing, the
`.ics` download and opening other apps. Decisions and reasons: [`PLAN.md`](PLAN.md), "Android app (phase 7)".

- App id `de.drnerdlove.lueckenfueller`; version number = the root `package.json` (`versionCode` = major * 10000 +
  minor * 100 + patch).
- Capacitor documents `server.url` as "not intended for use in production". We use it deliberately (decided
  2026-11-04) so the content never needs a new APK; `server.errorPath` shows `android-www/offline.html` when the page
  cannot be loaded (no network, GitHub down).
- The web app does not register its service worker inside the app; the app has its own notification path.

## Background check and notifications

- Switching notifications on in the app registers the phone with the server and stores a device key (it can only
  read the notification list).
- Android's WorkManager runs the check about every **15 minutes**; when the phone has been idle for long, Android
  delays it. A notification can therefore arrive up to ~15 minutes late, or later.
- The home server is off from 01:00 to 07:00: the check just fails quietly and tries again later.
- The notifications card in the app shows one line with the time of the last check and how it went (`ok`, `unavailable`,
  `error`; `CheckStorage.lastCheck`, plugin field `lastCheck`, text in `web/src/lib/app-check-status.ts`). It is read again
  when the app comes back to the front and right after switching on. A 401 or a missing key writes no check.
- The line also says how many notifications that check **really showed** (`count`): "nichts Neues", "1 neue
  Benachrichtigung", "3 neue Benachrichtigungen". An older shell without a count keeps "alles in Ordnung".
- A notification that Android does not let through (permission, the app's switch or the channel "Abstimmungen" turned off)
  counts as not shown: the check ends as `error` ("das hat nicht geklappt") and keeps the last id, so the notification comes
  once Android allows it again. `NotificationPoster.show` returns whether it really posted.
- Two buttons under the line (plugin `checkNow()` and `testNotification()`):
  - **Jetzt nachsehen** runs one check at once with the same code as the background one and records it. One shared lock
    (`CheckLock`) keeps the background work and this button from running at the same time (no notification twice, no raced
    last id).
  - **Test-Benachrichtigung** shows a local notification (tag `test`) without asking the server. Not seen although the app
    says "gesendet" means Android hides it (Einstellungen → Apps → Lückenfüller → Benachrichtigungen); if Android reports
    it as blocked, the app says so.
- **Check on open:** while the profile page is open, the app checks on loading and when it comes back to the front, at most
  once per 60 seconds (`web/src/lib/app-check-now.ts`). In addition `MainActivity.onResume` enqueues a one-time check
  (`CheckWorker.checkOnce`, unique name `notification-check-now`, `ExistingWorkPolicy.KEEP`, network required, at most once per
  60 s, time in memory) when a key is stored, so opening the app on any page looks for news. WorkManager keys unique work by
  name only, so this runs next to the periodic work (`notification-check`); both use `CheckWorker`'s logic and the lock.
- **Telling "nothing new" from "Android hides it":** press "Test-Benachrichtigung". Seen: Android shows notifications, so a
  line saying "nichts Neues" means the server had nothing for this account after the last id. Not seen: fix the settings
  above. A line with "1 neue Benachrichtigung" or more while none was seen also points at Android (or the notification was
  swiped away).
- All notifications use one channel, **"Abstimmungen"**. Texts are made in the app, in German time (Europe/Berlin).
- If the server answers 401 (key gone: logout, password change, switched off elsewhere), the check switches itself off.

## Colours (Material You)

- On Android 12 and newer (API 31+) the app wears the phone's system colours instead of the profile's seed colour.
  Below Android 12 nothing changes: the seed colour applies and the profile shows no switch.
- The plugin method `systemColors()` (`LueckenfuellerPlugin.kt`) reads the five palettes `system_accent1`,
  `system_accent2`, `system_accent3`, `system_neutral1`, `system_neutral2` with 13 shades each (0, 10, 50, 100, 200
  ... 1000) by resource name, with the activity's theme (so it follows the wallpaper).
- The web app (`web/src/lib/system-colors.ts`) maps Android shade N to Material tone 100 - N/10 and builds the same
  colour variables as for a seed colour with the library's `Scheme`, so primary is accent1 shade 600 (light) / 200
  (dark), the surfaces come from neutral1, outlines from neutral2. Android has no error palette; the error colours
  are Material's standard red. An incomplete answer (any shade missing) means: seed colour.
- The profile switch "Farben vom Handy übernehmen" is per device (stored in the app's web storage, on by default).
  The last palettes are cached there too, so the colours show at start before the plugin has answered. The app
  reads them again whenever it becomes visible, so a new wallpaper shows when you come back to the app.
- An older app shell without `systemColors()` simply keeps the seed colour (no error shown).

## For the owner: the signing key (once)

An Android app's identity is its signature. If the key is lost, no update can be installed over the old app any more:
everybody has to uninstall and reinstall. So: **never put the key into the repository, never replace it** unless
it has to be, and keep your own copy.

1. Open a shell in the VM and make the key in a folder only root can read:

   ```sh
   sudo install -d -m 700 /root/signing && cd /root/signing
   sudo docker run --rm -it -v /root/signing:/work -w /work eclipse-temurin:21-jdk \
     keytool -genkeypair -keystore lueckenfueller.keystore -storetype PKCS12 -alias lueckenfueller \
     -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Lueckenfueller"
   ```

   It asks for a password twice. Use a long one; the store and the key share it (PKCS12). **ASCII only** (letters
   a-z, A-Z, digits, plain symbols): keytool refuses umlauts, ß, € and the like with "Password is not ASCII" and
   writes no keystore.
2. Print what you need. The first command asks for the password and shows the certificate: the fingerprint is the
   line that starts with `SHA256:`. The second prints the keystore as one long line:

   ```sh
   sudo docker run --rm -it -v /root/signing:/work -w /work eclipse-temurin:21-jdk \
     keytool -list -v -keystore lueckenfueller.keystore -alias lueckenfueller
   sudo base64 -w0 /root/signing/lueckenfueller.keystore; echo
   ```

3. On GitHub: **Settings, Secrets and variables, Actions, New repository secret**:
   `ANDROID_KEYSTORE_BASE64` = the long line, `ANDROID_KEYSTORE_PASSWORD` = the password.
4. Put the SHA-256 fingerprint (upper case, colon separated, one line) into `android/signing-fingerprint.txt` in a
   pull request. It is not secret; every build compares the APK's signature with it and fails on a mismatch.
5. **Keep a copy of the keystore file and the password yourself**, in a safe place outside GitHub (password manager).
   Then delete the files from the VM: `sudo shred -u /root/signing/lueckenfueller.keystore`.

## Installing

- **Test APK (every push):** GitHub, Actions, the run of the push, section "Artifacts", `lueckenfueller-apk` (kept
  14 days). Unzip it on the phone or PC and open the `.apk`. Only exists once the secrets are set.
- **Release APK:** on the release page under "Assets": `lueckenfueller-<version>.apk`. Every release has one
  (`release.yml` builds it and fails without it). Download on the phone, open it, allow installing from this source
  once. An installed version is replaced and the login stays, because the signature is the same.

## Building and testing locally

Needs JDK 21 and the Android SDK (compileSdk 36). `npm ci` at the root first (`android/` uses
`node_modules/@capacitor/android`).

```sh
mkdir -p "$ANDROID_HOME/cmdline-tools" && cd "$ANDROID_HOME/cmdline-tools"
curl -O https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip commandlinetools-linux-11076708_latest.zip && mv cmdline-tools latest
yes | latest/bin/sdkmanager "platforms;android-36" "build-tools;35.0.0" "build-tools;36.0.0" "platform-tools"
```

Then, from the repository root, `bash scripts/android-apk.sh` does what CI does: `npx cap sync android` (fails if the
committed sync output was stale), unit tests, debug build, and, with `ANDROID_KEYSTORE_BASE64` and
`ANDROID_KEYSTORE_PASSWORD` set, the signed release and its fingerprint check. Or by hand in `android/`:
`./gradlew testDebugUnitTest assembleDebug`. Maven Central sometimes answers 429: use `--max-workers=2` and try once
more (the script does).

## Rules for changes

- The files Capacitor copies into `android/` and `android-www` are committed; CI checks they are current. After
  changing `capacitor.config.json` or `android-www`, run `npx cap sync android` and commit the result.
- Raise `SHELL_VERSION` in `android/app/build.gradle` by one whenever the shell changes in a way users need a new APK
  for (the app will offer an update only then, phase 7c).
- `NotificationText.kt` is a port of `web/src/lib/notification-text.ts`. The shared cases file `web/src/lib/notification-text.cases.json` is tested by both and
  keeps them equal; a new notification kind needs a text in both.
