/**
 * Which devices are on the network right now, and what to call them.
 */

import { DEVICE_TTL } from '../config.js';
import { listeners } from './sse.js';

// devices: deviceId -> { name, ip, lastSeen }
export const devices = new Map();

/** Minimal cookie parser - avoids pulling in cookie-parser. */
export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (key) out[key] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/** "iPhone", "Mac", "Windows PC" - a friendly label from the User-Agent. */
export function describeDevice(ua = '') {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android phone';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/CrOS/i.test(ua)) return 'Chromebook';
  if (/Linux/i.test(ua)) return 'Linux PC';
  return 'Device';
}

export function deviceName(id) {
  return devices.get(id)?.name || 'Unknown device';
}

/** A device with an open event stream counts as online even if idle. */
export function isOnline(id) {
  if (listeners.has(id)) return true;
  const d = devices.get(id);
  return !!d && Date.now() - d.lastSeen <= DEVICE_TTL;
}

export function pruneDevices() {
  for (const id of [...devices.keys()]) {
    if (!isOnline(id)) devices.delete(id);
  }
}
