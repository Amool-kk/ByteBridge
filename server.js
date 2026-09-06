/**
 * ByteBridge - entry point
 * ------------------------------
 * Serves a small static website (public/) and a JSON API to upload,
 * list, download and delete files stored in the local `uploads/` folder.
 *
 * The server binds to 0.0.0.0 so that any device on the same Wi-Fi/LAN
 * can reach it via the host machine's local IPv4 address.
 *
 * The application itself lives in src/ - this file only starts it.
 */

import { spawn } from 'child_process';
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

let server;

function openBrowser(url) {
  const launchers = {
    darwin: ['open'],
    win32: ['cmd', '/c', 'start', '', url],
    linux: ['xdg-open', url],
  };
  const command = launchers[process.platform];
  if (!command) return;

  const [bin, ...args] = command;
  if (process.platform === 'darwin') args.push(url);

  const child = spawn(bin, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}

function boot(portToTry, canFallback = true) {
  const instance = app.listen(portToTry, HOST, () => {
    server = instance;
    const address = instance.address();
    const activePort = typeof address === 'object' && address ? address.port : portToTry;
    const ip = getLocalIPv4();
    const url = `http://${ip}:${activePort}`;

    console.log('\n  ByteBridge is running\n');
    console.log(`  Local:    http://localhost:${activePort}`);
    console.log(`  Network:  ${url}`);
    console.log(`  Uploads:  ${UPLOAD_DIR}\n`);
    console.log('  Scan this QR code with a phone on the same Wi-Fi:\n');
    qrcodeTerminal.generate(url, { small: true });
    console.log('\n  Press Ctrl+C to stop.\n');
    openBrowser(url);
  });

  instance.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && canFallback) {
      console.warn(`Port ${portToTry} is busy. Retrying on a free port...`);
      boot(0, false);
      return;
    }
    console.error(err.code === 'EADDRINUSE' ? `Port ${portToTry} is already in use.` : 'Failed to start server:', err);
    process.exit(1);
  });
}

boot(PORT);

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
    if (server) server.close(() => process.exit(0));
    else process.exit(0);
  });
}
