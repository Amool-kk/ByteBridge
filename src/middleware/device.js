/**
 * Give every browser a stable, unguessable device id in a cookie, and record
 * that it is alive. `SameSite=Strict` is essential: without it any website you
 * visit could make authenticated requests to this server (CSRF).
 */

import crypto from 'crypto';

import { DEVICE_COOKIE_MAX_AGE } from '../config.js';
import { devices, parseCookies, describeDevice } from '../state/devices.js';
import { broadcast } from '../state/sse.js';

export function identifyDevice(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  let id = cookies.did;

  // Only accept ids in the exact shape we issue.
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(id)) id = null;

  if (!id) {
    id = crypto.randomBytes(24).toString('base64url'); // 32 chars
    res.setHeader(
      'Set-Cookie',
      `did=${id}; Path=/; Max-Age=${DEVICE_COOKIE_MAX_AGE}; HttpOnly; SameSite=Strict`
    );
  }

  req.deviceId = id;

  const existing = devices.get(id);
  const wasKnown = !!existing;
  devices.set(id, {
    // Keep a custom name the user set; otherwise derive one from the browser.
    name: existing?.name || describeDevice(req.headers['user-agent']),
    ip: req.socket.remoteAddress,
    lastSeen: Date.now(),
  });
  if (!wasKnown) broadcast('devices:changed');

  next();
}
