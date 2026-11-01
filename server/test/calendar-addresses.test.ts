import { describe, expect, it } from "vitest";
import { isPublicAddress } from "../src/calendars/addresses.js";

const publicAddresses = [
  "8.8.8.8",
  "1.1.1.1",
  "142.250.185.78",
  "93.184.216.34",
  "100.63.255.255", // just below 100.64/10
  "100.128.0.0", // just above 100.64/10
  "172.15.255.255", // just below 172.16/12
  "172.32.0.0", // just above 172.16/12
  "192.167.255.255",
  "192.169.0.0",
  "198.17.255.255",
  "198.20.0.0",
  "223.255.255.255", // just below multicast
  "2a00:1450:4001:82b::200e",
  "2606:4700:4700::1111",
  "2001:4860:4860::8888", // outside 2001::/23
  "2001:200::1", // just above 2001::/23
  "2001:db9::1", // next to the documentation range
  "2003::1", // next to 6to4
  "3ffe::1", // just below 3fff::/20
  "3fff:1000::1", // just above 3fff::/20
  "::ffff:8.8.8.8", // IPv4-mapped, public
  "::ffff:808:808", // same, hex form
  "::8.8.8.8", // IPv4-compatible, public
];

const notPublicAddresses = [
  // IPv4
  "0.0.0.0",
  "0.255.255.255",
  "10.0.0.1",
  "10.255.255.255",
  "100.64.0.1",
  "100.100.100.100", // Tailscale
  "100.127.255.255",
  "127.0.0.1",
  "127.255.255.254",
  "169.254.169.254",
  "172.16.0.1",
  "172.17.0.2", // Docker
  "172.31.255.255",
  "192.0.0.1",
  "192.0.2.5",
  "192.88.99.1",
  "192.168.0.1",
  "192.168.178.20",
  "198.18.0.1",
  "198.19.255.255",
  "198.51.100.7",
  "203.0.113.9",
  "224.0.0.1",
  "239.255.255.255",
  "240.0.0.1",
  "255.255.255.255",
  // IPv6
  "::",
  "::1",
  "fe80::1",
  "febf::1",
  "fc00::1",
  "fd00::1",
  "fd7a:115c:a1e0::1", // Tailscale
  "fd7a:115c:a1e0:ab12:4843:cd96:6200:1234",
  "ff02::1",
  "64:ff9b::808:808", // NAT64
  "100::1",
  "2001::1", // Teredo range
  "2001:1ff::1", // end of 2001::/23
  "2001:db8::1",
  "2001:db8:ffff::1",
  "2002::1",
  "2002:808:808::1", // 6to4 with a public IPv4 inside
  "3fff::1",
  "3fff:fff::1",
  "1::1", // outside 2000::/3
  "4000::1",
  "e000::1",
  // IPv4 inside IPv6
  "::ffff:127.0.0.1",
  "::ffff:10.0.0.5",
  "::ffff:7f00:1",
  "::ffff:a00:5",
  "::ffff:192.168.1.1",
  "::ffff:100.64.0.1",
  "::ffff:169.254.169.254",
  "::ffff:0.0.0.0",
  "::127.0.0.1",
  "::10.0.0.1",
  "0:0:0:0:0:ffff:7f00:1",
  // zone ids
  "fe80::1%eth0",
  "2a00:1450:4001:82b::200e%eth0",
  "8.8.8.8%eth0",
  // not an IP address at all
  "",
  " ",
  "example.com",
  "localhost",
  "8.8.8",
  "8.8.8.8.8",
  "256.1.1.1",
  "08.8.8.8",
  "0x7f.0.0.1",
  "2130706433",
  "8.8.8.8 ",
  "[::1]",
  "2a00:1450:4001:82b::200e::1",
  "12345::1",
  "g::1",
];

describe("isPublicAddress", () => {
  it.each(publicAddresses)("%s is public", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each(notPublicAddresses)("%j is not public", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it("treats the edges of an IPv4 range exactly", () => {
    expect(isPublicAddress("172.15.255.255")).toBe(true);
    expect(isPublicAddress("172.16.0.0")).toBe(false);
    expect(isPublicAddress("172.31.255.255")).toBe(false);
    expect(isPublicAddress("172.32.0.0")).toBe(true);
    expect(isPublicAddress("100.63.255.255")).toBe(true);
    expect(isPublicAddress("100.64.0.0")).toBe(false);
    expect(isPublicAddress("100.127.255.255")).toBe(false);
    expect(isPublicAddress("100.128.0.0")).toBe(true);
  });
});
