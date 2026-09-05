/**
 * The approval handshake. Metadata is exchanged first; bytes only move once
 * the receiver has said yes.
 */

import crypto from 'crypto';
import { promises as fsp } from 'fs';
import { Router } from 'express';

import { MAX_FILE_SIZE, MAX_FILES_PER_REQUEST, OFFER_TTL, MAX_PENDING_OFFERS_PER_DEVICE } from '../config.js';
import { sanitizeFilename } from '../lib/files.js';
import { formatBytes } from '../lib/format.js';
import { isOnline } from '../state/devices.js';
import { notify } from '../state/sse.js';
import { offers, publicOffer, settleOffer } from '../state/offers.js';
import { owners, saveOwners } from '../state/owners.js';
import { uploadFiles, sendUploadError } from '../middleware/upload.js';

const router = Router();

/**
 * POST /api/offers -> ask a device for permission to send files.
 * Body: { to, files: [{ name, size, type }] }
 * Only metadata is sent here; no bytes are transferred or written to disk.
 */
router.post('/offers', (req, res) => {
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
router.get('/offers', (req, res) => {
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
router.post('/offers/:id/approve', (req, res) => {
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
router.post('/offers/:id/decline', (req, res) => {
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
router.delete('/offers/:id', (req, res) => {
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
router.post('/offers/:id/upload', (req, res) => {
  const offer = offers.get(req.params.id);

  if (!offer || offer.from !== req.deviceId) {
    return res.status(404).json({ success: false, error: 'Request not found.' });
  }
  if (offer.status !== 'approved') {
    return res
      .status(403)
      .json({ success: false, error: `Cannot send: request is ${offer.status}.` });
  }

  uploadFiles(req, res, async (err) => {
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

export default router;
