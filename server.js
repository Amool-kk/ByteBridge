/**
 * Local File Share - entry point
 * ------------------------------
 * Serves a small static website (public/) and a JSON API to upload,
 * list, download and delete files stored in the local `uploads/` folder.
 *
 * The server binds to 0.0.0.0 so that any device on the same Wi-Fi/LAN
 * can reach it via the host machine's local IPv4 address.
 *
 * The application itself lives in src/ - this file only starts it.
 */

import qrcodeTerminal from 'qrcode-terminal';

import app from './src/app.js';
import { PORT, HOST, UPLOAD_DIR } from './src/config.js';
import { getLocalIPv4 } from './src/lib/network.js';
import { loadOwners, flushOwners } from './src/state/owners.js';
import { sweep } from './src/state/offers.js';
import { listeners } from './src/state/sse.js';

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
    // Persist any ownership change still sitting in the debounce window,
    // otherwise a private file would come back public after the restart.
    flushOwners();
    // Close every event stream so browsers don't hang on a dead connection.
    for (const set of listeners.values()) {
      for (const res of set) res.end();
    }
    server.close(() => process.exit(0));
  });
}
