# Server setup: VM, Tailscale Funnel and automatic updates

This guide sets up the Lückenfüller server on the owner's Windows PC, step by step. It is done once and takes
about an hour, most of it waiting for downloads. The reasons behind the set-up are in [`PLAN.md`](PLAN.md).

What you get at the end:

- A small Linux computer (a **virtual machine**, "VM") inside Hyper-V on the Windows PC. It starts by itself
  with Windows and shuts down cleanly with it. Home Assistant, Jellyfin and your files are not touched.
- The Lückenfüller server running in it, reachable from the internet **only** through Tailscale Funnel at an
  address like `https://lueckenfueller.<your-tailnet>.ts.net`. Nothing is opened on the router.
- Updates without your help:
  - **Server:** every hour the VM checks for a new version and switches to it. If a new version does not
    start properly, it goes back to the previous one by itself and waits for the next version.
  - **Debian** (the VM's operating system) and **Docker:** security updates are installed every day. New
    system versions take effect when the VM restarts, which happens every morning when the PC starts.
  - **Tailscale** updates itself.
- A **backup** of the database every night, encrypted and copied to a folder in your OneDrive (step 9).

You need:

- Windows 10/11 **Pro** (or Enterprise/Education) with **Hyper-V** switched on: Windows search, "Turn Windows
  features on or off", tick "Hyper-V", restart.
- About 10 GB of free disk space (the VM uses about 3–4 GB of it).
- A free **Tailscale** account: <https://login.tailscale.com/start> (sign in with Google, Microsoft, GitHub or
  Apple). If you already use Tailscale, use the same account.
- Your GitHub account (to tell the app where the server is, step 7).

## 1. Download Debian

1. Open <https://www.debian.org/distrib/> and download the small installation image for 64-bit PCs ("netinst",
   a file like `debian-13.x.x-amd64-netinst.iso`, about 700 MB).
2. Move it to a simple place, for example `C:\VMs\debian-netinst.iso` (create the folder `C:\VMs` first).

## 2. Create the VM

Open **PowerShell as administrator** (Windows search, "PowerShell", right-click, "Run as administrator"),
paste the whole block below and press Enter. If your ISO file has another name or place, change the first line.

```powershell
$Iso  = "C:\VMs\debian-netinst.iso"
$Name = "lueckenfueller"
$Disk = Join-Path (Get-VMHost).VirtualHardDiskPath "$Name.vhdx"

New-VM -Name $Name -Generation 2 -MemoryStartupBytes 1GB -NewVHDPath $Disk -NewVHDSizeBytes 10GB -SwitchName "Default Switch"
Set-VMMemory -VMName $Name -DynamicMemoryEnabled $false
Set-VMProcessor -VMName $Name -Count 2
# Linux needs this Secure Boot setting in Hyper-V.
Set-VMFirmware -VMName $Name -SecureBootTemplate MicrosoftUEFICertificateAuthority
$Dvd = Add-VMDvdDrive -VMName $Name -Path $Iso -Passthru
Set-VMFirmware -VMName $Name -FirstBootDevice $Dvd
# Start with Windows, shut down cleanly with Windows, no automatic snapshots (they fill the disk).
Set-VM -Name $Name -AutomaticStartAction Start -AutomaticStartDelay 30 -AutomaticStopAction ShutDown -AutomaticCheckpointsEnabled $false
vmconnect.exe localhost $Name
Start-VM -Name $Name
```

A window with the VM's screen opens. The disk grows only as needed; the 10 GB are a limit, not used up front.
"Default Switch" gives the VM internet access through Windows; the VM cannot be reached from the home network.

## 3. Install Debian

The installer starts in the VM window. Choose **"Install"** (not "Graphical install"; both work, this one is
faster) and answer:

| Question                          | Answer                                                                      |
| --------------------------------- | --------------------------------------------------------------------------- |
| Language / location / keyboard    | Deutsch / Deutschland / Deutsch (or what you prefer)                        |
| Hostname                          | `lueckenfueller`                                                            |
| Domain name                       | leave empty                                                                 |
| Root password                     | **leave empty** (twice). Your own user then gets administrator rights (sudo). |
| Full name, user name, password    | your choice, e.g. user name `admin`; write the password down                 |
| Partitioning                      | "Guided – use entire disk", the only disk, "All files in one partition", "Finish", "Yes" |
| Scan extra installation media     | No                                                                          |
| Package mirror                    | Deutschland, `deb.debian.org`, no proxy (leave empty)                        |
| Popularity contest                | your choice                                                                 |
| Software selection                | **untick** "Debian desktop environment" and "GNOME"; **tick** "SSH server" and "standard system utilities" |
| GRUB boot loader                  | Yes, on the only disk                                                       |

When it says "Installation complete", choose "Continue". The VM restarts and shows a text login. If it starts
the installer again, close the VM window, in Hyper-V Manager open the VM's "Settings", "DVD Drive", "None",
and start the VM again.

## 4. Connect from Windows

Typing long commands into the VM window is tedious, and it cannot paste. Use a terminal on Windows instead:

1. In the VM window, log in with your user name and password, then type `hostname -I` and press Enter. It
   shows the VM's address, e.g. `172.20.31.5`.
2. On Windows open **Terminal** or PowerShell (normal, not administrator) and type, with your user name and
   that address:

   ```powershell
   ssh admin@172.20.31.5
   ```

   Answer `yes` to the question about the fingerprint, then enter your password. From now on you can paste
   commands with a right-click.

The address can change after Windows restarts; run `hostname -I` in the VM window again if `ssh` stops working.
SSH is only reachable from this PC, not from the home network or the internet.

## 5. Run the setup

In the SSH window, paste these two lines:

```sh
wget -q -O setup.sh https://raw.githubusercontent.com/Dr-Nerdlove/gapfinder/main/deploy/vm/setup.sh
sudo bash setup.sh
```

Enter your password when asked. The script ([`deploy/vm/setup.sh`](../deploy/vm/setup.sh)) installs and sets up
everything; it prints a heading for each part. It stops twice and waits for you:

1. **"To authenticate, visit: https://login.tailscale.com/a/..."** – open that link (copy it from the window),
   log in to Tailscale and confirm the new machine `lueckenfueller`.
2. **Funnel** – if Tailscale has not yet allowed Funnel for your account, a second link appears. Open it and
   allow Funnel (and HTTPS certificates) for this machine. If no link appears, it is already allowed.

At the end it prints something like:

```
https://lueckenfueller.tail1234.ts.net (Funnel on)
|-- / proxy http://127.0.0.1:8080
```

That address (here `https://lueckenfueller.tail1234.ts.net`) is the **server address**. Write it down.

Test it: open `<server address>/api/health` in a browser on your phone (Wi-Fi off, so it really goes through the
internet). It should show a short text with `"status":"ok"`. The very first time it can take a minute until the
certificate is ready.

## 6. Switch off key expiry

Tailscale logs machines out after 180 days unless told otherwise; the server would then silently disappear.

1. Open <https://login.tailscale.com/admin/machines>.
2. On the machine `lueckenfueller`, click the three dots, **"Disable key expiry"**.

## 7. Tell the app the address

The app on GitHub Pages needs the server address once:

1. In GitHub open the repository, **Settings**, **Secrets and variables**, **Actions**, tab **Variables**,
   **New repository variable**.
2. Name: `API_URL`, value: the server address from step 5, without anything after `.ts.net`
   (e.g. `https://lueckenfueller.tail1234.ts.net`). Save.
3. Open the tab **Actions**, the workflow **Deploy**, **Run workflow**, **Run workflow**. After about two
   minutes the app is published again, now with the server address.

Open the app (<https://dr-nerdlove.github.io/gapfinder/>): it should say that the server is reachable.

The server address is not secret (it is visible in the published app anyway); still, there is no need to post
it anywhere.

## 8. Create your admin account

Accounts only exist through personal invite links. The very first one, yours, you create in the VM. Connect to
the VM with `ssh` (step 4). This works only once the server version with accounts is running in the VM: wait
about an hour after it was merged (the VM checks hourly), or update right away with this command in the VM:

```bash
sudo systemctl start lueckenfueller-update
```

Then run these two commands. Replace "Vorname Nachname" with your own name; it is only used to suggest your
username (e.g. "Vincent Richter" becomes "Vincent R."):

```bash
cd /opt/lueckenfueller
```

```bash
sudo docker compose exec api node server/dist/cli.js admin-link "Vorname Nachname"
```

It prints a link that looks like `https://dr-nerdlove.github.io/gapfinder/#/einladung/...`. Copy it, open it on
your phone **within 14 days** and choose your username and your password. The link works only once. Afterwards
you are logged in as admin; your friends' invite links you create in the app itself.

If the link has expired or got lost, just run the second command again for a new one.

## 9. Set up backups

Every night at about 00:30 (before the PC switches off at 01:00) the VM makes a backup of the database. If the
PC was off at that time, the backup is made a few minutes after it starts again. Each backup is:

- **encrypted** with your own backup key. Only you have its secret half (it is not kept in the VM), so nobody
  who gets hold of a backup file can read it. Without the key no backup can be restored: keep it safe.
- **kept in the VM** (the newest 14) and **copied to a folder in your OneDrive** on the Windows PC (the newest
  60). OneDrive uploads it to the cloud, so the backups survive a broken VM, a broken PC disk or a stolen PC.
  A copy that failed (the PC's folder was not reachable) is caught up the next night.

The backup is made while the server runs; the app keeps working. The files are small (a few hundred KB).

### Part 1: the folder on Windows

The VM writes into one shared folder on the PC, with its own Windows user that may do nothing else (it cannot
log in on the PC, and it can only reach this one folder). Open **PowerShell as administrator** (as in step 2)
and paste this whole block:

```powershell
$Folder   = Join-Path $env:OneDrive "Lückenfüller-Sicherung"
$User     = "lueckenbackup"
$Password = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })

# A Windows user only for the backups. It does not appear on the login screen.
New-LocalUser -Name $User -Password (ConvertTo-SecureString $Password -AsPlainText -Force) -PasswordNeverExpires -UserMayNotChangePassword -Description "Lückenfüller backups from the VM"
$Hide = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList"
New-Item -Path $Hide -Force | Out-Null
New-ItemProperty -Path $Hide -Name $User -Value 0 -PropertyType DWord -Force | Out-Null

# The folder in OneDrive, shared only with that user.
New-Item -ItemType Directory -Force -Path $Folder | Out-Null
icacls $Folder /grant "${User}:(OI)(CI)M" | Out-Null
New-SmbShare -Name "lueckenfueller-backup" -Path $Folder -ChangeAccess $User | Out-Null

# Let only the VM (through Hyper-V's "Default Switch") reach the shared folder, not the home network.
New-NetFirewallRule -DisplayName "Lückenfüller backups from the VM" -Direction Inbound -Protocol TCP -LocalPort 445 -InterfaceAlias "vEthernet (Default Switch)" -Action Allow | Out-Null

Write-Host "Folder:   $Folder"
Write-Host "Password: $Password"
```

It shows the folder (it should be inside your OneDrive, e.g. `C:\Users\<you>\OneDrive\Lückenfüller-Sicherung`)
and a password. **Keep the PowerShell window open**: you need the password in part 2. You do not have to write
it down; if it is ever needed again, part 3 below makes a new one.

If the first line fails or the folder is not in OneDrive (`$env:OneDrive` is empty when OneDrive is not set up
for this Windows user), set `$Folder` by hand to a folder inside your OneDrive and run the block again.

### Part 2: the VM

Connect to the VM with `ssh` (step 4). If you set up the VM before backups existed, first run the setup again
(see "When the files in `deploy/vm/` change"). Then:

```bash
sudo lueckenfueller-backup setup
```

It asks:

1. **"If you already have a backup key, paste it now."** The first time, just press Enter. It then shows your
   new **secret backup key**, a line starting with `AGE-SECRET-KEY-`. Copy it and save it **in your password
   manager**, and also print it or write it down and keep that at home. To confirm, it asks for the key's last
   6 characters.
2. **The share and the Windows user**: press Enter twice (`lueckenfueller-backup` and `lueckenbackup`).
3. **The password**: paste the password from the PowerShell window (nothing is shown while you paste) and
   press Enter.

It tests the connection and makes a first backup. It ends with `lueckenfueller-backup: done`. In Windows, the
folder now holds a file like `lueckenfueller-2026-11-01-153012.sqlite.age`, and OneDrive shows it as synced.

Now do the **trial restore** below once, to be sure that your saved key works.

### Part 3: if something changes later

- **New password for the Windows user** (forgotten, or changed): in PowerShell as administrator run the first
  three lines of the block in part 1, then `Set-LocalUser -Name $User -Password (ConvertTo-SecureString
  $Password -AsPlainText -Force)` and `Write-Host $Password`; then `sudo lueckenfueller-backup setup` in the VM
  again (it keeps the key).
- **The key is lost**: the old backups can no longer be opened. In the VM run
  `sudo rm /opt/lueckenfueller/backup-settings/public-key.txt` and `sudo lueckenfueller-backup setup`; it creates
  a new key. Backups from then on use the new key.

## Forgot your own admin password

Friends who forget their password ask you; you make a new link for them in the admin area of the app. If you
forget yours, create a link in the VM. Replace the name in quotes with your username exactly as the app shows
it (upper and lower case do not matter):

```bash
cd /opt/lueckenfueller
```

```bash
sudo docker compose exec api node server/dist/cli.js password-link "Vincent R."
```

Open the printed link on your phone **within 24 hours** and choose a new password. The link works only once, and
all logins of this account end when you use it.

## Restoring a backup

All commands below run in the VM (connect with `ssh`, step 4). They ask for your **secret backup key**: paste
it from your password manager (nothing is shown while you paste) and press Enter. The key is used only for
this one command and not stored.

### Trial restore (once after setting up, then about once a month)

```bash
sudo lueckenfueller-backup check
```

It takes the newest backup, opens it with your key and checks it, **without changing anything**; the server
keeps running. It shows how many accounts the backup holds and when the last activity was, and ends with
`trial restore passed`. If it says the key cannot open the backup, you have the wrong key: look for the right
one now, while the server still runs fine.

To try an older backup, add a part of its name, e.g. the date: `sudo lueckenfueller-backup check 2026-10-30`.

### Which backups there are

```bash
sudo lueckenfueller-backup list
```

The names contain date and time, e.g. `lueckenfueller-2026-10-31-003012.sqlite.age` is from 31 October at
00:30.

### Restore

This replaces the server's database with a backup. **Everything that happened after the backup is lost**
(new accounts, changed passwords, ...). Use it only when the data is really broken or gone.

```bash
sudo lueckenfueller-backup restore
```

It restores the newest backup; to choose another one, add a part of its name, e.g.
`sudo lueckenfueller-backup restore 2026-10-30`. It first checks the backup (as in the trial restore) and asks
you to type `yes`. Then it stops the server for a moment, saves the current state as an extra backup (its
name ends in `-before-restore`), puts the backup in place and starts the server again. At the end it prints
the command to **undo** the restore, e.g.:

```bash
sudo lueckenfueller-backup restore 2026-11-01-142233-before-restore
```

The replaced database files also stay in `/opt/lueckenfueller/replaced-<date>`; you can delete that folder
once everything works.

### The VM is lost completely

If the VM is broken or deleted, the backups are still in your OneDrive folder.

1. Set up a new VM as in steps 2–6 (on the Tailscale admin page, remove the old machine `lueckenfueller` first,
   so the new one gets the same address).
2. Make sure the folder from "9. Set up backups", part 1, still exists and is shared (in PowerShell:
   `Get-SmbShare lueckenfueller-backup`). If you set up Windows again too, run part 1 again and copy the
   backup files from OneDrive into the new folder.
3. In the VM run `sudo lueckenfueller-backup setup`. At the first question **paste your existing secret
   backup key** (do not press Enter, that would create a new key). Then answer as in part 2. It finds the old
   backups in the Windows folder and does not make a new backup yet.
4. Right away run `sudo lueckenfueller-backup restore`. It downloads the newest backup from the Windows folder
   and restores it. Everyone can log in again as before.

## Everyday operation

Nothing to do. When the PC is off (01:00–07:00), the app says "Lückenfüller schläft gerade"; in the morning
Windows starts the VM, the server starts, and a few minutes later the VM checks for a new server version.

To look at the server, connect with `ssh` (step 4) and use:

| What                                    | Command                                                         |
| --------------------------------------- | --------------------------------------------------------------- |
| Is the server running and healthy?      | `curl http://127.0.0.1:8080/api/health`                         |
| Last updates and their result           | `sudo journalctl -u lueckenfueller-update -n 30`                |
| When the next update check runs         | `systemctl list-timers lueckenfueller-update.timer`             |
| Update right now                        | `sudo lueckenfueller-update`                                    |
| Last backups and their result           | `sudo journalctl -u lueckenfueller-backup -n 30`                |
| Which backups there are                 | `sudo lueckenfueller-backup list`                               |
| Back up right now                       | `sudo lueckenfueller-backup`                                    |
| Server log                              | `cd /opt/lueckenfueller && sudo docker compose logs --tail 50`  |
| Is Funnel on, and the address           | `tailscale funnel status`                                       |

Where things are in the VM:

- `/opt/lueckenfueller/compose.yaml` – how the server container runs (from [`deploy/vm/compose.yaml`](../deploy/vm/compose.yaml)).
- `/opt/lueckenfueller/.env` – the server's settings. Secrets added in later phases go here, never into the
  repository.
- `/opt/lueckenfueller/data/` – the database. **This is the data to keep**; the backups protect it.
- `/opt/lueckenfueller/backups/` – the newest 14 backups (encrypted). `/opt/lueckenfueller/backup-settings/` –
  the backup key's public half and the login for the Windows folder.
- `/usr/local/sbin/lueckenfueller-backup` and the `lueckenfueller-backup` timer – the nightly backup
  ([`deploy/vm/backup.sh`](../deploy/vm/backup.sh)).
- `/usr/local/sbin/lueckenfueller-update` and the `lueckenfueller-update` timer – the hourly update
  ([`deploy/vm/update.sh`](../deploy/vm/update.sh)).

### When the files in `deploy/vm/` change

The hourly update only replaces the server program. When a later change touches the files in `deploy/vm/`
(the release notes say so), run the setup again; it keeps the settings and the database:

```sh
wget -q -O setup.sh https://raw.githubusercontent.com/Dr-Nerdlove/gapfinder/main/deploy/vm/setup.sh
sudo bash setup.sh
```

This is deliberate: the VM never runs new setup scripts from the internet on its own.

## If something goes wrong

- **The app says the server sleeps, although the PC is on.** In Hyper-V Manager check that the VM
  `lueckenfueller` is "Running". Then, via `ssh`, run the health check and `tailscale funnel status` from the
  table above. If Funnel is off: `sudo tailscale funnel --bg 8080`.
- **An update went back to the old version.** The update log (`sudo journalctl -u lueckenfueller-update`)
  says "is not healthy; going back". The app keeps working on the old version. Send the log to the AI assistant
  working on the project; the next fixed version is installed automatically.
- **A backup failed.** `sudo journalctl -u lueckenfueller-backup -n 30` shows why. "cannot reach the Windows
  folder" means the backup is safe in the VM and is copied the next night; if it keeps happening, check that
  the shared folder still exists (`Get-SmbShare lueckenfueller-backup` in PowerShell) and run
  `sudo lueckenfueller-backup setup` again. If Windows security ("Controlled folder access") blocks the
  writes, allow them there.
- **`ssh` does not connect.** The address changed: run `hostname -I` in the VM window.
- **Start over completely.** In Hyper-V Manager turn the VM off and delete it, delete
  `lueckenfueller.vhdx`, remove the machine in the Tailscale admin page, and begin at step 2. This deletes the
  database in the VM; to bring it back, follow "The VM is lost completely" above.

## What this set-up does for security

- The router stays closed. The VM connects out to Tailscale; Funnel forwards only HTTPS on port 443 to the
  server, nothing else (not SSH, not the home network, not the WireGuard VPN). TLS ends inside the VM, so
  Tailscale's relay cannot read the traffic.
- The server listens only on `127.0.0.1` inside the VM and runs in a container as a normal user with a
  read-only file system and no extra rights.
- The server image is public (the code is AGPL anyway), so the VM needs no GitHub password.
- Backups are encrypted with [age](https://age-encryption.org/) to a key whose secret half only the owner has;
  the VM holds only the public half, so even someone who breaks into the VM cannot read the older backups in
  OneDrive. The Windows user for the backups can only reach its one shared folder, and the firewall lets only
  the VM's virtual network reach it.
- The server trusts the visitor address that Tailscale passes on (`TRUST_PROXY=true` in `.env`), which is
  correct only because Funnel is the only way in. Do not publish port 8080 any other way.
