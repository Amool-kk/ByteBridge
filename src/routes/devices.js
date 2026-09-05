/**
 * Presence: who else has the page open, renaming, and the event stream.
 */

import { Router } from 'express';

import { MAX_SSE_PER_DEVICE } from '../config.js';
import { devices, deviceName, pruneDevices } from '../state/devices.js';
import { listeners, sseSend, broadcast } from '../state/sse.js';

const router = Router();

/** GET /api/devices -> who else has the page open right now */
router.get('/devices', (req, res) => {
  pruneDevices();

  const list = [...devices.keys()].map((id) => ({
    id,
    name: deviceName(id),
    isYou: id === req.deviceId,
  }));

  res.json({ success: true, you: req.deviceId, devices: list });
});

/** POST /api/devices/me -> rename this device */
router.post('/devices/me', (req, res) => {
  // eslint-disable-next-line no-control-regex
  const name = String(req.body?.name ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
  if (!name) {
    return res.status(400).json({ success: false, error: 'Name cannot be empty.' });
  }

  const device = devices.get(req.deviceId);
  if (device) device.name = name;
  broadcast('devices:changed');

  res.json({ success: true, name });
});

/** GET /api/events -> Server-Sent Events stream (plain HTTP push) */
router.get('/events', (req, res) => {
  const set = listeners.get(req.deviceId) || new Set();
  if (set.size >= MAX_SSE_PER_DEVICE) {
    return res.status(429).json({ success: false, error: 'Too many open connections.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write(':ok\n\n'); // flush headers immediately

  set.add(res);
  listeners.set(req.deviceId, set);

  sseSend(res, 'ready', { you: req.deviceId });
  broadcast('devices:changed');

  // Comment lines keep the connection from being closed as idle.
  const ping = setInterval(() => {
    res.write(':ping\n\n');
    const device = devices.get(req.deviceId);
    if (device) device.lastSeen = Date.now();
  }, 25_000);

  req.on('close', () => {
    clearInterval(ping);
    set.delete(res);
    if (set.size === 0) listeners.delete(req.deviceId);
    broadcast('devices:changed');
  });
});

export default router;
