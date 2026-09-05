/**
 * What the frontend needs to know about this server: the LAN URL, a QR code
 * for it, and the limits it should enforce before uploading.
 */

import { Router } from 'express';
import QRCode from 'qrcode';

import { PORT, MAX_FILE_SIZE, MAX_FILES_PER_REQUEST, OFFER_TTL } from '../config.js';
import { getLocalIPv4 } from '../lib/network.js';
import { formatBytes } from '../lib/format.js';

const router = Router();

/** GET /api/info -> server URL + QR code (data URL) for the frontend */
router.get('/info', async (req, res, next) => {
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

export default router;
