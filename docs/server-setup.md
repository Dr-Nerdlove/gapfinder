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
curl -fsSLO https://raw.githubusercontent.com/Dr-Nerdlove/gapfinder/main/deploy/vm/setup.sh
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
| Server log                              | `cd /opt/lueckenfueller && sudo docker compose logs --tail 50`  |
| Is Funnel on, and the address           | `tailscale funnel status`                                       |

Where things are in the VM:

- `/opt/lueckenfueller/compose.yaml` – how the server container runs (from [`deploy/vm/compose.yaml`](../deploy/vm/compose.yaml)).
- `/opt/lueckenfueller/.env` – the server's settings. Secrets added in later phases go here, never into the
  repository.
- `/opt/lueckenfueller/data/` – the database. **This is the data to keep.** Backups follow in a later step.
- `/usr/local/sbin/lueckenfueller-update` and the `lueckenfueller-update` timer – the hourly update
  ([`deploy/vm/update.sh`](../deploy/vm/update.sh)).

### When the files in `deploy/vm/` change

The hourly update only replaces the server program. When a later change touches the files in `deploy/vm/`
(the release notes say so), run the setup again; it keeps the settings and the database:

```sh
curl -fsSLO https://raw.githubusercontent.com/Dr-Nerdlove/gapfinder/main/deploy/vm/setup.sh
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
- **`ssh` does not connect.** The address changed: run `hostname -I` in the VM window.
- **Start over completely.** In Hyper-V Manager turn the VM off and delete it, delete
  `lueckenfueller.vhdx`, remove the machine in the Tailscale admin page, and begin at step 2. This deletes the
  database.

## What this set-up does for security

- The router stays closed. The VM connects out to Tailscale; Funnel forwards only HTTPS on port 443 to the
  server, nothing else (not SSH, not the home network, not the WireGuard VPN). TLS ends inside the VM, so
  Tailscale's relay cannot read the traffic.
- The server listens only on `127.0.0.1` inside the VM and runs in a container as a normal user with a
  read-only file system and no extra rights.
- The server image is public (the code is AGPL anyway), so the VM needs no GitHub password.
- The server trusts the visitor address that Tailscale passes on (`TRUST_PROXY=true` in `.env`), which is
  correct only because Funnel is the only way in. Do not publish port 8080 any other way.
