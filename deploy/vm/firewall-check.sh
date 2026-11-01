#!/usr/bin/env bash
# Checks from inside the server container that the firewall (firewall.nft) works: the server reaches the
# internet, but not the Windows PC, the VM or Tailscale.
#
# Installed by setup.sh as /usr/local/sbin/lueckenfueller-firewall-check; setup.sh runs it as its last step.
# Run it by hand with:  sudo lueckenfueller-firewall-check
#
# The container must be running. It tries a few connections (3 seconds each) with node inside the container
# and prints one line per check. Only a connection attempt that gets no answer at all counts as "blocked":
# a refusal means the packet got through.
set -euo pipefail

APP_DIR="${LUECKENFUELLER_DIR:-/opt/lueckenfueller}"

fail() { echo "lueckenfueller-firewall-check: ERROR: $*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 || -n "${LUECKENFUELLER_DIR:-}" ]] || fail "please run with sudo:  sudo lueckenfueller-firewall-check"

# The Windows PC as seen from the VM: Hyper-V's "Default Switch" makes it the VM's default gateway.
pc="$(ip route show default 2>/dev/null | awk '$1 == "default" { print $3; exit }')"
# The VM's own Tailscale address (empty when Tailscale is not up).
ts="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"

# Arguments: the PC's address, the VM's Tailscale address (each may be empty).
# Must stay blocked: the PC (SMB), the container's own gateway = the VM on the Docker network (SSH), the
# VM's Tailscale address (SSH). Must connect: a public website (DNS and internet work).
read -r -d '' js <<'JS' || true
const net = require("node:net");
const fs = require("node:fs");
// "reached" when the other side answered: a connection, or a refusal (the packet got there, only nothing
// listens on that port). The firewall drops packets silently, so a blocked address only ever times out.
const tryConnect = (host, port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (result) => { socket.destroy(); resolve(result); };
    socket.setTimeout(3000);
    socket.once("connect", () => done({ reached: true, how: "connected" }));
    socket.once("timeout", () => done({ reached: false, how: "no answer" }));
    socket.once("error", (e) =>
      done(e.code === "ECONNREFUSED" ? { reached: true, how: "refused, so it got there" } : { reached: false, how: e.code || "error" }));
  });
// The container's default gateway from /proc/net/route (address in hex, little endian).
const gateway = () => {
  for (const line of fs.readFileSync("/proc/net/route", "utf8").split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f[1] === "00000000" && f[2]) {
      const n = parseInt(f[2], 16);
      return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255].join(".");
    }
  }
  return "";
};
(async () => {
  const [pc, ts] = process.argv.slice(1);
  const checks = [];
  if (pc) checks.push({ what: "the Windows PC", host: pc, port: 445, want: false });
  const gw = gateway();
  if (gw) checks.push({ what: "the VM (Docker network)", host: gw, port: 22, want: false });
  if (ts) checks.push({ what: "Tailscale (this VM)", host: ts, port: 22, want: false });
  checks.push({ what: "the internet", host: "calendar.google.com", port: 443, want: true });
  let bad = 0;
  for (const c of checks) {
    const result = await tryConnect(c.host, c.port);
    // The internet check needs a real connection; the others must not get there at all.
    const good = c.want ? result.how === "connected" : !result.reached;
    if (!good) bad++;
    console.log(`${good ? "ok  " : "FAIL"} ${c.what} (${c.host}:${c.port}): ${result.how}, ${c.want ? "should connect" : "should be blocked"}`);
  }
  process.exit(bad ? 1 : 0);
})();
JS

cd "$APP_DIR"
if docker compose exec -T api node -e "$js" "$pc" "$ts"; then
  echo "Firewall check passed: the server reaches the internet, but not the PC, the VM or Tailscale."
else
  echo "Firewall check FAILED: see the lines marked FAIL above (or the server is not running)." >&2
  exit 1
fi
