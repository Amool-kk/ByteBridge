/**
 * Server-Sent Events: plain HTTP, so it works over http://192.168.x.x with
 * no extra dependency. If it fails we still have the polling fallback.
 *
 * This module imports the loaders; none of them may import it back.
 */

import { state } from './state.js';
import { toast } from './util.js';
import { loadFiles } from './files.js';
import { loadDevices } from './devices.js';
import { loadOffers } from './offers.js';
import { sendFiles } from './upload.js';
import { api } from './api.js';

export function connectEvents() {
  const source = new EventSource('/api/events');

  source.addEventListener('ready', (e) => {
    state.myDeviceId = JSON.parse(e.data).you;
  });

  source.addEventListener('devices:changed', () => loadDevices());
  source.addEventListener('files:changed', () => loadFiles());

  source.addEventListener('offer:new', (e) => {
    const offer = JSON.parse(e.data);
    toast(`${offer.fromName} wants to send you ${offer.files.length} file(s)`, 'info');
    loadOffers();
  });

  // The receiver said yes - now, and only now, do the bytes go out.
  source.addEventListener('offer:approved', (e) => {
    const offer = JSON.parse(e.data);
    loadOffers();
    if (!state.pendingSend || state.pendingSend.offerId !== offer.id) return;

    const { files } = state.pendingSend;
    state.pendingSend = null;
    sendFiles(api.offerUploadUrl(offer.id), files);
  });

  for (const status of ['declined', 'cancelled', 'expired']) {
    source.addEventListener(`offer:${status}`, (e) => {
      const offer = JSON.parse(e.data);
      if (state.pendingSend?.offerId === offer.id) state.pendingSend = null;
      if (offer.from === state.myDeviceId) {
        toast(`${offer.toName} ${status} your transfer`, status === 'declined' ? 'error' : 'info');
      }
      loadOffers();
    });
  }

  source.addEventListener('offer:delivered', (e) => {
    const offer = JSON.parse(e.data);
    if (offer.to === state.myDeviceId) {
      toast(`Received ${offer.files.length} file(s) from ${offer.fromName}`, 'success');
    }
    loadOffers();
    loadFiles();
  });

  // EventSource reconnects on its own; just resync when it does.
  source.addEventListener('open', () => {
    loadDevices();
    loadOffers();
  });
}
