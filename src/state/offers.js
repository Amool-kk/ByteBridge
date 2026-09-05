/**
 * Offers (the approval handshake).
 *
 * An "offer" is a request to send files. The sender only transmits metadata
 * first; the bytes are uploaded *after* the receiver approves.
 *
 *   pending -> approved -> delivered
 *           -> declined | expired | cancelled
 */

import { devices, deviceName, pruneDevices } from './devices.js';
import { notify, broadcast } from './sse.js';

export const offers = new Map();

/** Shape sent to the browser - never leaks internal fields. */
export function publicOffer(offer) {
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
export function settleOffer(offer, status) {
  offer.status = status;
  const payload = publicOffer(offer);
  notify(offer.from, `offer:${status}`, payload);
  notify(offer.to, `offer:${status}`, payload);
}

/** Drop stale offers and disappeared devices. Runs on a timer. */
export function sweep() {
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
