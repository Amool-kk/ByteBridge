/**
 * Assembles the Express application: middleware in the order that matters,
 * then the API routes, then the fallbacks.
 *
 * Kept separate from server.js so the app can be built without binding a port.
 */

import express from 'express';

import { PUBLIC_DIR } from './config.js';
import { hostGuard } from './middleware/hostGuard.js';
import { identifyDevice } from './middleware/device.js';
import filesRoutes from './routes/files.js';
import devicesRoutes from './routes/devices.js';
import offersRoutes from './routes/offers.js';
import infoRoutes from './routes/info.js';

const app = express();

// Order matters: reject foreign hosts before doing any work, identify the
// device before any route reads req.deviceId, and parse JSON before the
// routes that need a body.
app.use(hostGuard);
app.use(identifyDevice);
app.use(express.json({ limit: '100kb' }));

// Serve the frontend. `index: 'index.html'` handles `GET /`.
app.use(
  express.static(PUBLIC_DIR, {
    index: 'index.html',
    // Static assets only; uploaded files are NOT served from here.
    dotfiles: 'ignore',
  })
);

app.use('/api', filesRoutes);
app.use('/api', devicesRoutes);
app.use('/api', offersRoutes);
app.use('/api', infoRoutes);

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

export default app;
