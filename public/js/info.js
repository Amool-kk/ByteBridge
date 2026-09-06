/**
 * The header card: the LAN URL, its QR code, and the copy button.
 */

import { serverUrlEl, copyUrlBtn, qrImage, maxSizeEl } from './dom.js';
import { api } from './api.js';
import { toast } from './util.js';

export async function loadServerInfo() {
  try {
    const { data } = await api.info();
    if (!data.success) return;

    serverUrlEl.textContent = data.url;
    serverUrlEl.href = data.url;
    qrImage.src = data.qr;
    qrImage.style.display = 'block';
    maxSizeEl.textContent = data.maxFileSizeLabel || `${data.maxFileSizeMb} MB`;
  } catch {
    serverUrlEl.textContent = window.location.origin;
    serverUrlEl.href = window.location.origin;
  }
}

export function initInfo() {
  copyUrlBtn.addEventListener('click', async () => {
    const url = serverUrlEl.textContent.trim();
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied to clipboard', 'success');
    } catch {
      toast('Copy failed — select the link manually', 'error');
    }
  });
}
