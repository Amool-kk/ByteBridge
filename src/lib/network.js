/**
 * Working out which IPv4 address a phone on the same Wi-Fi can actually open.
 */

import os from 'os';

// Interfaces that are never a real Wi-Fi/LAN connection: VPN tunnels,
// virtual machine / container bridges, Apple AWDL, dial-up, etc.
const VIRTUAL_IFACE = /^(utun|tun|tap|ppp|awdl|llw|bridge|vmnet|vboxnet|docker|veth|vEthernet|ZeroTier|Hamachi|Tailscale)/i;

// Physical adapters, in the order we prefer them.
const PHYSICAL_IFACE = /^(en|eth|wl|wlan|wlp|enp|eno|ens|Wi-?Fi|Ethernet)/i;

/** Higher score = more likely to be the address your phone can reach. */
function scoreAddress(name, address) {
  let score = 0;

  // 1. Address range matters most.
  if (address.startsWith('192.168.')) {
    score += 100; // classic home Wi-Fi router range
  } else if (/^10\./.test(address)) {
    score += 80; // common on larger/office networks
  } else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) {
    score += 60; // private range, but also used by Docker
  } else if (/^(198\.1[89]|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(address)) {
    score -= 60; // benchmark range / CGNAT - typical of VPN tunnels
  }

  // 2. Then the kind of adapter.
  if (VIRTUAL_IFACE.test(name)) {
    score -= 100;
  } else if (PHYSICAL_IFACE.test(name)) {
    score += 40;
    // en0 / eth0 is usually the primary adapter, en1 the secondary, ...
    const index = Number((name.match(/(\d+)$/) || [])[1]);
    if (Number.isInteger(index)) score += Math.max(0, 10 - index);
  }

  return score;
}

/**
 * Pick the IPv4 address other devices on your Wi-Fi can actually reach.
 *
 * Why not just "first non-internal address"? os.networkInterfaces() returns
 * adapters in OS order, so a VPN tunnel (utun0), Docker bridge or VirtualBox
 * adapter often comes first and you end up advertising an address like
 * 198.19.254.2 that no phone on your Wi-Fi can open.
 *
 * Instead we score every candidate and return the best one.
 *
 * Set LAN_IP=192.168.1.10 to override the detection entirely.
 */
export function getLocalIPv4() {
  if (process.env.LAN_IP) return process.env.LAN_IP;

  const candidates = [];

  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const net of addresses || []) {
      // Node >= 18 reports family as the number 4; older versions use 'IPv4'.
      const isIPv4 = net.family === 'IPv4' || net.family === 4;
      if (!isIPv4 || net.internal) continue;

      // 169.254.x.x means DHCP failed - the address is not usable.
      if (net.address.startsWith('169.254.')) continue;

      candidates.push({ name, address: net.address, score: scoreAddress(name, net.address) });
    }
  }

  if (candidates.length === 0) return '127.0.0.1';

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].address;
}
