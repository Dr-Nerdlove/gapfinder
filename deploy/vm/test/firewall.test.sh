#!/usr/bin/env bash
# Tests deploy/vm/firewall.nft in network namespaces, so the host's own rules and network are never touched:
#
#   ctr  (the server container)  --[br-lftest]--  vm  (the VM, forwards packets)  --[eth0]--  inet
#
# "inet" plays the internet (1.2.3.4, 1.1.1.1, 9.9.9.9) and the home network (192.168.178.1, 10.1.1.1,
# 100.100.100.100 = Tailscale, 172.20.5.1) at once, behind the VM's second network card. The VM's bridge is
# named like Docker's (br-*), which is what the rules look at.
# Needs root, ip (iproute2), nft (nftables) and node. Run:  sudo bash deploy/vm/test/firewall.test.sh
# FIREWALL_NFT=<file> tests another copy of the rules (for sabotage checks).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULES="${FIREWALL_NFT:-$HERE/../firewall.nft}"
ID="$$"
VM="lftvm$ID"
CTR="lftctr$ID"
INET="lftinet$ID"
WORK="$(mktemp -d)"
PIDS=()

for tool in ip nft node; do
  command -v "$tool" >/dev/null || { echo "$tool is not installed (needed for this test)" >&2; exit 1; }
done
[[ "$(id -u)" -eq 0 ]] || { echo "run as root:  sudo bash deploy/vm/test/firewall.test.sh" >&2; exit 1; }

cleanup() {
  local pid ns
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  for ns in "$CTR" "$VM" "$INET"; do ip netns del "$ns" 2>/dev/null || true; done
  rm -rf "$WORK"
}
trap cleanup EXIT

# --- The test network -------------------------------------------------------------------------------

for ns in "$VM" "$CTR" "$INET"; do ip netns add "$ns"; done
in_vm() { ip netns exec "$VM" "$@"; }
in_ctr() { ip netns exec "$CTR" "$@"; }
in_inet() { ip netns exec "$INET" "$@"; }

# container <-> VM: the VM's end is called like a Docker bridge.
ip link add br-lftest netns "$VM" type veth peer name eth0 netns "$CTR"
in_vm ip addr add 172.30.0.1/24 dev br-lftest
in_vm ip link set br-lftest up
in_ctr ip addr add 172.30.0.2/24 dev eth0
in_ctr ip link set eth0 up
in_ctr ip link set lo up
in_ctr ip route add default via 172.30.0.1

# VM <-> "internet and home network"
ip link add eth0 netns "$VM" type veth peer name eth0 netns "$INET"
in_vm ip addr add 10.99.0.1/30 dev eth0
in_vm ip link set eth0 up
in_vm ip link set lo up
in_inet ip addr add 10.99.0.2/30 dev eth0
in_inet ip link set eth0 up
in_inet ip link set lo up
in_inet ip route add 172.30.0.0/24 via 10.99.0.1
PUBLIC=(1.2.3.4 1.1.1.1 9.9.9.9)
HOME_NET=(192.168.178.1 10.1.1.1 100.100.100.100 172.20.5.1)
for address in "${PUBLIC[@]}" "${HOME_NET[@]}"; do
  in_inet ip addr add "$address/32" dev lo
  in_vm ip route add "$address/32" via 10.99.0.2
done
in_vm sysctl -q -w net.ipv4.ip_forward=1

# --- Listeners and the client -----------------------------------------------------------------------

# A server that answers "hello" with "echo:hello" on the given TCP ports and UDP ports (udp:PORT).
cat >"$WORK/server.js" <<'JS'
const net = require("node:net");
const dgram = require("node:dgram");
const fs = require("node:fs");
const [readyFile, ...ports] = process.argv.slice(2);
let waiting = ports.length;
const ready = () => { if (--waiting === 0) fs.writeFileSync(readyFile, "ready"); };
for (const p of ports) {
  if (p.startsWith("udp:")) {
    const socket = dgram.createSocket("udp4");
    socket.on("message", (msg, rinfo) => socket.send("echo:" + msg, rinfo.port, rinfo.address));
    socket.bind(Number(p.slice(4)), "0.0.0.0", ready);
  } else {
    net.createServer((c) => {
      c.on("data", (d) => c.write("echo:" + d));
      c.on("error", () => {});
    }).listen(Number(p), "0.0.0.0", ready);
  }
}
JS

# Tries all targets (host:port, or udp:host:port) at the same time. Prints "<target> <result>" per target:
# "reply" (connected, said hello, got the answer), "connected" (no answer) or "blocked" (anything else,
# including "refused" and a timeout: only a working connection counts as reachable).
cat >"$WORK/client.js" <<'JS'
const net = require("node:net");
const dgram = require("node:dgram");
const TIMEOUT = 2000;
const tcp = (host, port) => new Promise((resolve) => {
  let state = "blocked";
  const socket = net.connect({ host, port });
  const done = () => { socket.destroy(); resolve(state); };
  socket.setTimeout(TIMEOUT, done);
  socket.once("error", done);
  socket.once("connect", () => { state = "connected"; socket.write("hello"); });
  socket.on("data", (d) => { if (String(d) === "echo:hello") { state = "reply"; done(); } });
  socket.once("close", done);
});
const udp = (host, port) => new Promise((resolve) => {
  const socket = dgram.createSocket("udp4");
  let finished = false;
  const done = (r) => { if (!finished) { finished = true; socket.close(); resolve(r); } };
  socket.on("message", (d) => done(String(d) === "echo:hello" ? "reply" : "blocked"));
  socket.on("error", () => done("blocked"));
  socket.send("hello", port, host);
  setTimeout(() => done("blocked"), TIMEOUT);
});
Promise.all(process.argv.slice(2).map(async (t) => {
  const isUdp = t.startsWith("udp:");
  const [host, port] = (isUdp ? t.slice(4) : t).split(":");
  const result = await (isUdp ? udp : tcp)(host, Number(port));
  return `${t} ${result}`;
})).then((lines) => console.log(lines.join("\n")));
JS

start_server() { # <namespace> <ready file> <ports...>
  local ns="$1" ready="$2"
  shift 2
  ip netns exec "$ns" node "$WORK/server.js" "$ready" "$@" &
  PIDS+=("$!")
  local waited=0
  while [[ ! -f "$ready" ]]; do
    sleep 0.1
    waited=$((waited + 1))
    if ((waited > 100)); then echo "the test server in $ns did not start" >&2; exit 1; fi
  done
}

start_server "$INET" "$WORK/inet-ready" 443 25 53 445 22 udp:53
start_server "$VM" "$WORK/vm-ready" 22 445

# --- Loading the rules ------------------------------------------------------------------------------

in_vm nft -f "$RULES"
first="$(in_vm nft list ruleset)"
# Loading the file a second time must replace the table, not add the rules once more.
in_vm nft -f "$RULES"
second="$(in_vm nft list ruleset)"

# --- Checks -----------------------------------------------------------------------------------------

failures=0
from_ctr="" from_vm=""

result_is() { # <output> <target> <wanted result>
  [[ "$(grep -F -- "$2 " <<<"$1" | head -n 1 | cut -d' ' -f2)" == "$3" ]]
}

check() { # <what> <command...>
  local what="$1"
  shift
  if "$@"; then
    echo "ok   $what"
  else
    echo "FAIL $what"
    failures=$((failures + 1))
  fi
}

# The container: ports 443 and 53 at public addresses; the home network and the VM are out of reach.
targets=(1.2.3.4:443 1.1.1.1:443 1.2.3.4:25 1.2.3.4:22 1.2.3.4:80 9.9.9.9:53 1.1.1.1:53 1.2.3.4:53 udp:9.9.9.9:53 udp:1.2.3.4:53
  172.30.0.1:22 10.99.0.1:22)
for address in "${HOME_NET[@]}"; do targets+=("$address:443" "$address:445" "$address:22"); done
from_ctr="$(in_ctr node "$WORK/client.js" "${targets[@]}")"

# The VM itself: everything at home is reachable (this is how the backups reach the Windows PC), and so is
# the internet. This also shows that the container's "blocked" above comes from the firewall, not the routes.
vm_targets=(1.2.3.4:443 1.2.3.4:25)
for address in "${HOME_NET[@]}"; do vm_targets+=("$address:445" "$address:443"); done
from_vm="$(in_vm node "$WORK/client.js" "${vm_targets[@]}")"

check "loading the rules a second time changes nothing (no doubled rules)" [ "$first" == "$second" ]
check "there is one table, ours" [ "$(grep -c '^table ' <<<"$second")" -eq 1 ]
check "container -> public address :443 connects and data goes both ways" result_is "$from_ctr" 1.2.3.4:443 reply
check "container -> second public address :443 connects" result_is "$from_ctr" 1.1.1.1:443 reply
check "container -> public address :25 is blocked" result_is "$from_ctr" 1.2.3.4:25 blocked
check "container -> public address :22 is blocked" result_is "$from_ctr" 1.2.3.4:22 blocked
check "container -> public address :80 is blocked" result_is "$from_ctr" 1.2.3.4:80 blocked
check "container -> 9.9.9.9:53 (TCP) connects" result_is "$from_ctr" 9.9.9.9:53 reply
check "container -> 1.1.1.1:53 (TCP) connects" result_is "$from_ctr" 1.1.1.1:53 reply
check "container -> 9.9.9.9:53 (UDP) gets an answer" result_is "$from_ctr" udp:9.9.9.9:53 reply
check "container -> another public address :53 (TCP) is blocked" result_is "$from_ctr" 1.2.3.4:53 blocked
check "container -> another public address :53 (UDP) is blocked" result_is "$from_ctr" udp:1.2.3.4:53 blocked
for address in "${HOME_NET[@]}"; do
  for port in 443 445 22; do
    check "container -> home address $address:$port is blocked" result_is "$from_ctr" "$address:$port" blocked
  done
done
check "container -> the VM's bridge address :22 is blocked" result_is "$from_ctr" 172.30.0.1:22 blocked
check "container -> the VM's other address :22 is blocked" result_is "$from_ctr" 10.99.0.1:22 blocked
check "VM -> public address :443 connects" result_is "$from_vm" 1.2.3.4:443 reply
check "VM -> public address :25 connects (the VM itself is not limited)" result_is "$from_vm" 1.2.3.4:25 reply
for address in "${HOME_NET[@]}"; do
  check "VM -> home address $address:445 still connects (backups)" result_is "$from_vm" "$address:445" reply
done
check "VM -> the Windows PC 192.168.178.1:445 still connects" result_is "$from_vm" 192.168.178.1:445 reply

if ((failures > 0)); then
  echo "$failures check(s) failed"
  exit 1
fi
echo "all firewall tests passed"
