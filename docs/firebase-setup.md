# Firebase setup (instant notifications for the Android app)

This guide is for the owner. It sets up Google's Firebase as a "doorbell": when news arises, the server rings the
phone and the app then asks your server what is new. Google learns only that a phone should look, never what
about. Without it, the app checks every 15 minutes, which keeps working.

> The English menu names below were checked on the Firebase site on 2026-11-05 and were all correct. If Google
> renames something later and a step looks different, tell the assistant where, so the guide can be fixed.

## 1. Create the Firebase project

1. Open <https://console.firebase.google.com> and log in with your Google account.
2. Click **Create a project** (or **Add project**). Name: `Lueckenfueller`. Continue.
3. **Google Analytics: switch it OFF** (not needed). Click **Create project**, wait, then **Continue**.

Worked when you see the project's start page with its name at the top left.

## 2. Add the Android app and get `google-services.json`

1. On the start page click the **Android** icon (or **Add app**, then Android).
2. Package name, exactly: `de.drnerdlove.lueckenfueller`. App nickname and the SHA-1 field can stay empty. Click
   **Register app**.
3. Click **Download google-services.json**. Then click through the remaining steps (**Next**, **Next**,
   **Continue to console**); there is nothing to install by hand.
4. Pass the file on. It is **not secret** (it is inside every APK anyway). Either give it to the assistant in a
   chat, or upload it on GitHub to the path `android/app/google-services.json` on a new branch (**Add file →
   Upload files**). A session then commits it in a pull request.

Worked when the file is in the pull request and the next app build contains it.

## 3. Make the service-account key (secret!)

1. In Firebase click the gear next to **Project Overview → Project settings → Service accounts**.
2. Click **Generate new private key**, confirm with **Generate key**. A `.json` file is downloaded.
3. **This file IS secret.** Never put it into a chat, on GitHub or into OneDrive.
4. Copy it to the VM and run the setup as described in [`server-setup.md`](server-setup.md), step 11 (the script
   stores the key in the VM and deletes the copy there).
5. Then delete the downloaded file on Windows and empty the recycle bin.

Worked when `setup.sh` says it stored the key and the admin page card shows "Bereit" (step 5 below).

If the key is lost or leaked: open <https://console.cloud.google.com>, choose the project, **IAM & Admin →
Service accounts**, click the Firebase service account, tab **Keys**, delete that key, then make a new one (this
step) and run the setup again.

## 4. Restrict the API key (recommended)

The API key inside `google-services.json` is public, so limit what it may do.

1. Find the signature: after this change is merged, open GitHub → **Actions → CI** → the latest run on `main` → job
   **android**, and copy the line `Signature (SHA-1, for Firebase): ...`.
2. Open <https://console.cloud.google.com>, choose the project, **APIs & Services → Credentials**.
3. Click the key **Android key (auto created by Firebase)**.
4. Under **Application restrictions** choose **Android apps**, click **Add an item**, enter package name
   `de.drnerdlove.lueckenfueller` and the SHA-1 from step 1. **Save**.
5. Optional: in Firebase **Project settings → Your apps →** the Android app **→ Add fingerprint**, paste the same
   SHA-1.

Builds signed with another key (debug or test builds) will then get no ring; that is fine, the 15-minute check
still works for them.

## 5. Check that it works

1. Install the new APK and open the app once. A phone that already had notifications on then sends its token to
   the server by itself (at the latest with the next check, within about 15 minutes); nothing to switch.
2. In the web app open the admin page: the card **Sofort-Benachrichtigungen (Android)** must say **Bereit** and
   count the phones that can be rung.
3. Make the server send you a real notification. ("Test-Benachrichtigung" on the profile page does not help here:
   the phone shows it by itself, without the server.) On the PC, create a poll, open its share link in a private
   browser window and vote there as a guest. Lock the phone first. The notification about the new vote should
   arrive within a few seconds, not after up to 15 minutes. (The setting for new votes must be on in your profile.)

If not: the card says what is missing. Check also that the phone allows notifications and has Google services.

## 6. What Google sees

- The ring contains no content: no title, text, poll or name, only "look now".
- Google also knows the phone's token (a personal identifier). The server stores it with the phone's key and
  deletes it when notifications are switched off. The app's privacy page says this in German.
- The 15-minute check stays as a backup.
