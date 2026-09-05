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
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const qrcodeTerminal = require('qrcode-terminal');

const app = express();
// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0'; // listen on every network interface -> reachable on LAN
const UPLOAD_DIR = path.join(__dirname, 'uploads');

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

/**
 * Find the machine's LAN IPv4 address (e.g. 192.168.1.20) so we can print a
 * URL that other devices are able to open. Falls back to localhost.
 */
function getLocalIPv4() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(express.json({ limit: '100kb' }));

// Serve the frontend. `index: 'index.html'` handles `GET /`.
app.use(
  express.static(path.join(__dirname, 'public'), {
    index: 'index.html',
    // Static assets only; uploaded files are NOT served from here.
    dotfiles: 'ignore',
  })
);

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
    server.close(() => process.exit(0));
  });
}
