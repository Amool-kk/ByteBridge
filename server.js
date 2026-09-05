/**
 * Local File Share - Express server
 * ---------------------------------
 * Serves a small static website (public/) and a JSON API to upload,
 * list, download and delete files stored in the local `uploads/` folder.
 *
 * The server binds to 0.0.0.0 so that any device on the same Wi-Fi/LAN
 * can reach it via the host machine's local IPv4 address.
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');

const app = express();
// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0'; // listen on every network interface -> reachable on LAN
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB per file
const MAX_FILES_PER_REQUEST = 20;

// Where we remember which device owns which file (so targeted files stay
// private across restarts). The leading dot keeps it out of the file listing.
const META_FILE = path.join(UPLOAD_DIR, '.meta.json');

// A device is "online" if we heard from it within this window.
const DEVICE_TTL = 15_000;
const DEVICE_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days
const MAX_SSE_PER_DEVICE = 5; // tabs open per device

// A send request the receiver never answers is dropped after this long.
const OFFER_TTL = 120_000;
const MAX_PENDING_OFFERS_PER_DEVICE = 5;

// Create the uploads directory on startup if it is missing.
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Turn any user supplied name into a safe, flat file name.
 * - strips directory components (`../../etc/passwd` -> `passwd`)
 * - removes characters that are illegal/awkward on Windows & Unix
 * - collapses whitespace and limits the length
 */
function sanitizeFilename(originalName) {
  // Only keep the base name: kills path traversal segments entirely.
  let name = path.basename(String(originalName || ''));

  // Windows-style separators are not handled by path.basename on POSIX.
  name = name.split('\\').pop();

  // Drop control chars and characters that are invalid in file names.
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '');

  // Leading dots would create hidden files; leading dashes confuse CLIs.
  name = name.replace(/^[.\-\s]+/, '');

  // Collapse repeated whitespace.
  name = name.replace(/\s+/g, ' ').trim();

  if (!name) name = 'file';

  // Keep the extension while limiting the total length.
  const ext = path.extname(name).slice(0, 20);
  const base = path.basename(name, path.extname(name)).slice(0, 120) || 'file';
  return base + ext;
}

/**
 * Resolve a requested file name to an absolute path *inside* UPLOAD_DIR.
 * Returns null when the result would escape the uploads folder.
 * This is the single guard against path traversal for download/delete.
 */
function resolveInsideUploads(requestedName) {
  if (typeof requestedName !== 'string' || requestedName.length === 0) return null;
  if (requestedName.includes('\0')) return null;

  const safeName = path.basename(requestedName.split('\\').pop());
  if (!safeName || safeName === '.' || safeName === '..') return null;

  const fullPath = path.resolve(UPLOAD_DIR, safeName);
  const root = path.resolve(UPLOAD_DIR) + path.sep;

  if (!fullPath.startsWith(root)) return null;
  return fullPath;
}

/** If `name` already exists in uploads, append " (1)", " (2)", ... */
async function uniqueFilename(name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = name;
  let counter = 1;

  // Loop until we find a name that is not taken.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await fsp.access(path.join(UPLOAD_DIR, candidate));
      candidate = `${base} (${counter})${ext}`;
      counter += 1;
    } catch {
      return candidate; // access() threw -> file does not exist -> free
    }
  }
}

// Interfaces that are never a real Wi-Fi/LAN connection: VPN tunnels,
// virtual machine / container bridges, Apple AWDL, dial-up, etc.
const VIRTUAL_IFACE = /^(utun|tun|tap|ppp|awdl|llw|bridge|vmnet|vboxnet|docker|veth|vEthernet|ZeroTier|Hamachi|Tailscale)/i;

// Physical adapters, in the order we prefer them.
const PHYSICAL_IFACE = /^(en|eth|wl|wlan|wlp|enp|eno|ens|Wi-?Fi|Ethernet)/i;

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
function getLocalIPv4() {
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

/** 5368709120 -> "5 GB" (for human-readable error messages). */
function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// File ownership
// ---------------------------------------------------------------------------
// owners: filename -> { from, to, at }
//   `to === null`  -> shared with everyone
//   `to === <id>`  -> only the sender and that one device may see/download it
// Files on disk with no record (e.g. copied in manually) count as public.
let owners = new Map();

function loadOwners() {
  try {
    const raw = fs.readFileSync(META_FILE, 'utf8');
    owners = new Map(Object.entries(JSON.parse(raw)));
  } catch {
    owners = new Map(); // first run, or unreadable file
  }
}

let saveTimer = null;
/** Debounced atomic write, so a burst of uploads only writes once. */
function saveOwners() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const tmp = `${META_FILE}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(Object.fromEntries(owners), null, 2));
      await fsp.rename(tmp, META_FILE); // rename is atomic
    } catch (err) {
      console.error('Could not save file ownership:', err);
    }
  }, 200);
}

/** May this device see / download / delete this file? */
function canAccess(filename, deviceId) {
  const owner = owners.get(filename);
  if (!owner || owner.to === null) return true; // public
  return owner.to === deviceId || owner.from === deviceId;
}

// ---------------------------------------------------------------------------
// Devices (presence)
// ---------------------------------------------------------------------------
// devices: deviceId -> { name, ip, lastSeen }
const devices = new Map();

/** Minimal cookie parser - avoids pulling in cookie-parser. */
function parseCookies(header = '') {
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
function describeDevice(ua = '') {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android phone';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/CrOS/i.test(ua)) return 'Chromebook';
  if (/Linux/i.test(ua)) return 'Linux PC';
  return 'Device';
}

function deviceName(id) {
  return devices.get(id)?.name || 'Unknown device';
}

/** A device with an open event stream counts as online even if idle. */
function isOnline(id) {
  if (listeners.has(id)) return true;
  const d = devices.get(id);
  return !!d && Date.now() - d.lastSeen <= DEVICE_TTL;
}

function pruneDevices() {
  for (const id of [...devices.keys()]) {
    if (!isOnline(id)) devices.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Server-Sent Events (plain HTTP push - no WebSocket needed)
// ---------------------------------------------------------------------------
// listeners: deviceId -> Set<response>   (a device may have several tabs open)
const listeners = new Map();

function sseSend(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Push an event to every tab of one device. */
function notify(deviceId, type, data = {}) {
  for (const res of listeners.get(deviceId) || []) sseSend(res, type, data);
}

/** Push an event to everyone (used when the device list changes). */
function broadcast(type, data = {}) {
  for (const set of listeners.values()) {
    for (const res of set) sseSend(res, type, data);
  }
}

// ---------------------------------------------------------------------------
// Offers (the approval handshake)
// ---------------------------------------------------------------------------
// An "offer" is a request to send files. The sender only transmits metadata
// first; the bytes are uploaded *after* the receiver approves.
//
//   pending -> approved -> delivered
//           -> declined | expired | cancelled
const offers = new Map();

/** Shape sent to the browser - never leaks internal fields. */
function publicOffer(offer) {
  return {
    id: offer.id,
    from: offer.from,
    to: offer.to,
    fromName: deviceName(offer.from),
    toName: deviceName(offer.to),
    files: offer.files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
    totalSize: offer.files.reduce((sum, f) => sum + f.size, 0),
    status: offer.status,
    createdAt: new Date(offer.createdAt).toISOString(),
    expiresAt: new Date(offer.expiresAt).toISOString(),
  };
}

/** Move an offer to a final state and tell both sides. */
function settleOffer(offer, status) {
  offer.status = status;
  const payload = publicOffer(offer);
  notify(offer.from, `offer:${status}`, payload);
  notify(offer.to, `offer:${status}`, payload);
}

/** Drop stale offers and disappeared devices. Runs on a timer. */
function sweep() {
  const now = Date.now();

  for (const [id, offer] of offers) {
    const active = offer.status === 'pending' || offer.status === 'approved';
    if (active && now > offer.expiresAt) settleOffer(offer, 'expired');

    // Keep finished offers around briefly so the UI can show the outcome.
    if (!active && now - offer.expiresAt > 60_000) offers.delete(id);
  }

  const before = devices.size;
  pruneDevices();
  if (devices.size !== before) broadcast('devices:changed');
}

// ---------------------------------------------------------------------------
// Multer setup (handles multipart/form-data uploads)
// ---------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  async filename(req, file, cb) {
    try {
      // Browsers may send latin1-decoded names; re-decode as UTF-8.
      const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const safe = sanitizeFilename(decoded);
      cb(null, await uniqueFilename(safe));
    } catch (err) {
      cb(err);
    }
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES_PER_REQUEST,
  },
});

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Give every browser a stable, unguessable device id in a cookie, and record
 * that it is alive. `SameSite=Strict` is essential: without it any website you
 * visit could make authenticated requests to this server (CSRF).
 */
app.use((req, res, next) => {
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
});

app.use(express.json({ limit: '100kb' }));

// Serve the frontend. `index: 'index.html'` handles `GET /`.
app.use(
  express.static(path.join(__dirname, 'public'), {
    index: 'index.html',
    // Static assets only; uploaded files are NOT served from here.
    dotfiles: 'ignore',
  })
);

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

/** GET /api/files -> files this device is allowed to see */
app.get('/api/files', async (req, res, next) => {
  try {
    const entries = await fsp.readdir(UPLOAD_DIR, { withFileTypes: true });

    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
        .filter((entry) => canAccess(entry.name, req.deviceId))
        .map(async (entry) => {
          const stats = await fsp.stat(path.join(UPLOAD_DIR, entry.name));
          const owner = owners.get(entry.name);
          return {
            name: entry.name,
            size: stats.size,
            uploadedAt: stats.mtime.toISOString(),
            // `private` drives the badge in the UI.
            private: !!(owner && owner.to !== null),
            fromName: owner ? deviceName(owner.from) : null,
            toName: owner && owner.to ? deviceName(owner.to) : null,
            sentByMe: !!(owner && owner.from === req.deviceId),
          };
        })
    );

    // Newest first.
    files.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    res.json({ success: true, count: files.length, files });
  } catch (err) {
    next(err);
  }
});

/**
 * Turn a Multer failure into a friendly JSON response.
 * Shared by the public upload route and the approved-offer upload route.
 */
function sendUploadError(res, err) {
  if (err instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: `File is too large. Maximum size is ${formatBytes(MAX_FILE_SIZE)}.`,
      LIMIT_FILE_COUNT: `Too many files. Maximum is ${MAX_FILES_PER_REQUEST} per upload.`,
      LIMIT_UNEXPECTED_FILE: 'Unexpected form field. Use the field name "files".',
    };
    return res.status(413).json({
      success: false,
      error: messages[err.code] || `Upload error: ${err.code}`,
    });
  }
  console.error('Upload failed:', err);
  return res.status(500).json({ success: false, error: 'Upload failed.' });
}

/** POST /api/upload -> share one or many files with everyone (field: "files") */
app.post('/api/upload', (req, res) => {
  upload.array('files', MAX_FILES_PER_REQUEST)(req, res, (err) => {
    if (err) return sendUploadError(res, err);

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files were provided.' });
    }

    const uploaded = req.files.map((f) => ({
      name: f.filename,
      size: f.size,
      uploadedAt: new Date().toISOString(),
    }));

    // No ownership record = visible to everyone on the network.
    broadcast('files:changed');

    res.status(201).json({
      success: true,
      message: `${uploaded.length} file(s) uploaded.`,
      files: uploaded,
    });
  });
});

/** GET /api/download/:filename -> stream a file back as an attachment */
app.get('/api/download/:filename', async (req, res, next) => {
  const fullPath = resolveInsideUploads(req.params.filename);
  if (!fullPath) {
    return res.status(400).json({ success: false, error: 'Invalid file name.' });
  }

  try {
    const stats = await fsp.stat(fullPath);
    if (!stats.isFile()) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }

    // 404 rather than 403: don't reveal that someone else's file exists.
    if (!canAccess(path.basename(fullPath), req.deviceId)) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }

    // Force a download instead of letting the browser render/execute the file.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.download(fullPath, path.basename(fullPath), (err) => {
      if (err && !res.headersSent) next(err);
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }
    next(err);
  }
});

/** DELETE /api/files/:filename -> remove a file from uploads/ */
app.delete('/api/files/:filename', async (req, res, next) => {
  const fullPath = resolveInsideUploads(req.params.filename);
  if (!fullPath) {
    return res.status(400).json({ success: false, error: 'Invalid file name.' });
  }

  try {
    const stats = await fsp.stat(fullPath);
    if (!stats.isFile()) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }

    const name = path.basename(fullPath);
    if (!canAccess(name, req.deviceId)) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }

    await fsp.unlink(fullPath);
    owners.delete(name);
    saveOwners();
    broadcast('files:changed');
    res.json({ success: true, message: 'File deleted.', name });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

/** GET /api/devices -> who else has the page open right now */
app.get('/api/devices', (req, res) => {
  pruneDevices();

  const list = [...devices.keys()].map((id) => ({
    id,
    name: deviceName(id),
    isYou: id === req.deviceId,
  }));

  res.json({ success: true, you: req.deviceId, devices: list });
});

/** POST /api/devices/me -> rename this device */
app.post('/api/devices/me', (req, res) => {
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
app.get('/api/events', (req, res) => {
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

// ---------------------------------------------------------------------------
// Offers - the approval handshake
// ---------------------------------------------------------------------------

/**
 * POST /api/offers -> ask a device for permission to send files.
 * Body: { to, files: [{ name, size, type }] }
 * Only metadata is sent here; no bytes are transferred or written to disk.
 */
app.post('/api/offers', (req, res) => {
  const { to, files } = req.body || {};

  if (typeof to !== 'string' || to === req.deviceId || !isOnline(to)) {
    return res.status(400).json({ success: false, error: 'That device is not available.' });
  }

  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES_PER_REQUEST) {
    return res
      .status(400)
      .json({ success: false, error: `Send between 1 and ${MAX_FILES_PER_REQUEST} files.` });
  }

  // Don't let one device spam another with approval prompts.
  const pending = [...offers.values()].filter(
    (o) => o.from === req.deviceId && (o.status === 'pending' || o.status === 'approved')
  );
  if (pending.length >= MAX_PENDING_OFFERS_PER_DEVICE) {
    return res
      .status(429)
      .json({ success: false, error: 'You already have too many requests waiting.' });
  }

  const declared = [];
  for (const file of files) {
    const size = Number(file?.size);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_SIZE) {
      return res.status(413).json({
        success: false,
        error: `Each file must be ${formatBytes(MAX_FILE_SIZE)} or smaller.`,
      });
    }
    declared.push({
      name: sanitizeFilename(String(file?.name ?? '')),
      size,
      type: String(file?.type ?? '').slice(0, 100),
    });
  }

  const now = Date.now();
  const offer = {
    id: crypto.randomBytes(16).toString('base64url'),
    from: req.deviceId,
    to,
    files: declared,
    status: 'pending',
    createdAt: now,
    expiresAt: now + OFFER_TTL,
  };
  offers.set(offer.id, offer);

  notify(to, 'offer:new', publicOffer(offer));
  res.status(201).json({ success: true, offer: publicOffer(offer) });
});

/** GET /api/offers -> requests waiting for me, and mine that are in flight */
app.get('/api/offers', (req, res) => {
  const all = [...offers.values()];
  res.json({
    success: true,
    incoming: all.filter((o) => o.to === req.deviceId && o.status === 'pending').map(publicOffer),
    outgoing: all
      .filter((o) => o.from === req.deviceId && (o.status === 'pending' || o.status === 'approved'))
      .map(publicOffer),
  });
});

/** POST /api/offers/:id/approve -> receiver accepts; sender may now upload */
app.post('/api/offers/:id/approve', (req, res) => {
  const offer = offers.get(req.params.id);

  // 404 for anyone who is not the intended recipient - don't confirm it exists.
  if (!offer || offer.to !== req.deviceId) {
    return res.status(404).json({ success: false, error: 'Request not found.' });
  }
  if (offer.status !== 'pending') {
    return res.status(409).json({ success: false, error: `Request already ${offer.status}.` });
  }

  offer.status = 'approved';
  offer.expiresAt = Date.now() + OFFER_TTL; // give the upload its own window
  const payload = publicOffer(offer);
  notify(offer.from, 'offer:approved', payload);
  notify(offer.to, 'offer:approved', payload);

  res.json({ success: true, offer: payload });
});

/** POST /api/offers/:id/decline -> receiver refuses; nothing is ever sent */
app.post('/api/offers/:id/decline', (req, res) => {
  const offer = offers.get(req.params.id);
  if (!offer || offer.to !== req.deviceId) {
    return res.status(404).json({ success: false, error: 'Request not found.' });
  }
  if (offer.status !== 'pending' && offer.status !== 'approved') {
    return res.status(409).json({ success: false, error: `Request already ${offer.status}.` });
  }

  settleOffer(offer, 'declined');
  res.json({ success: true, offer: publicOffer(offer) });
});

/** DELETE /api/offers/:id -> sender withdraws the request */
app.delete('/api/offers/:id', (req, res) => {
  const offer = offers.get(req.params.id);
  if (!offer || offer.from !== req.deviceId) {
    return res.status(404).json({ success: false, error: 'Request not found.' });
  }

  settleOffer(offer, 'cancelled');
  res.json({ success: true, offer: publicOffer(offer) });
});

/**
 * POST /api/offers/:id/upload -> the only route that accepts bytes for a
 * targeted send. Rejects unless the caller created the offer AND the receiver
 * has approved it.
 */
app.post('/api/offers/:id/upload', (req, res) => {
  const offer = offers.get(req.params.id);

  if (!offer || offer.from !== req.deviceId) {
    return res.status(404).json({ success: false, error: 'Request not found.' });
  }
  if (offer.status !== 'approved') {
    return res
      .status(403)
      .json({ success: false, error: `Cannot send: request is ${offer.status}.` });
  }

  upload.array('files', MAX_FILES_PER_REQUEST)(req, res, async (err) => {
    if (err) return sendUploadError(res, err);

    const received = req.files || [];

    /** Throw away anything already written - used on every rejection path. */
    const discard = () =>
      Promise.all(received.map((f) => fsp.unlink(f.path).catch(() => {})));

    // The bytes must match what the receiver agreed to. Otherwise a sender
    // could get approval for a 10 KB text file and push a 5 GB payload.
    const sizesMatch =
      received.length === offer.files.length &&
      received.every((f, i) => f.size === offer.files[i].size);

    if (!sizesMatch) {
      await discard();
      settleOffer(offer, 'declined');
      return res.status(400).json({
        success: false,
        error: 'Files did not match the approved request. Transfer cancelled.',
      });
    }

    // Record who may see these files, then persist so a restart keeps them private.
    const at = new Date().toISOString();
    for (const file of received) {
      owners.set(file.filename, { from: offer.from, to: offer.to, at });
    }
    saveOwners();

    offer.status = 'delivered';
    const payload = {
      ...publicOffer(offer),
      files: received.map((f) => ({ name: f.filename, size: f.size })),
    };
    notify(offer.to, 'offer:delivered', payload);
    notify(offer.from, 'offer:delivered', payload);

    res.status(201).json({ success: true, message: 'Files sent.', ...payload });
  });
});

/** GET /api/info -> server URL + QR code (data URL) for the frontend */
app.get('/api/info', async (req, res, next) => {
  try {
    const url = `http://${getLocalIPv4()}:${PORT}`;
    const qr = await QRCode.toDataURL(url, { width: 240, margin: 1 });
    res.json({
      success: true,
      url,
      qr,
      maxFileSizeMb: Math.round(MAX_FILE_SIZE / (1024 * 1024)),
      maxFileSizeLabel: formatBytes(MAX_FILE_SIZE),
      maxFiles: MAX_FILES_PER_REQUEST,
      offerTtlSeconds: Math.round(OFFER_TTL / 1000),
    });
  } catch (err) {
    next(err);
  }
});

// 404 for unknown API routes.
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found.' });
});

// Central error handler - never leak stack traces to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  if (res.headersSent) return;
  res.status(500).json({ success: false, error: 'Internal server error.' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
loadOwners();

// Expire stale offers and forget devices that went away.
const sweeper = setInterval(sweep, 10_000);

const server = app.listen(PORT, HOST, () => {
  const ip = getLocalIPv4();
  const url = `http://${ip}:${PORT}`;

  console.log('\n  Local File Share is running\n');
  console.log(`  Local:    http://localhost:${PORT}`);
  console.log(`  Network:  ${url}`);
  console.log(`  Uploads:  ${UPLOAD_DIR}\n`);
  console.log('  Scan this QR code with a phone on the same Wi-Fi:\n');
  qrcodeTerminal.generate(url, { small: true });
  console.log('\n  Press Ctrl+C to stop.\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try: PORT=4000 npm start`);
  } else {
    console.error('Failed to start server:', err);
  }
  process.exit(1);
});

// Graceful shutdown.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\nShutting down...');
    clearInterval(sweeper);
    // Close every event stream so browsers don't hang on a dead connection.
    for (const set of listeners.values()) {
      for (const res of set) res.end();
    }
    server.close(() => process.exit(0));
  });
}
