/**
 * Sending: the progress-tracked byte transfer, and the metadata-only request
 * that has to be approved before any bytes leave this tab.
 */

import { state } from './state.js';
import {
  uploadBtn,
  clearBtn,
  targetSelect,
  progressWrap,
  progressFill,
  progressLabel,
} from './dom.js';
import { api } from './api.js';
import { toast } from './util.js';
import { renderSelected } from './selection.js';
import { loadFiles } from './files.js';
import { loadOffers } from './offers.js';

/**
 * Upload the given files to `url` with a progress bar.
 * Used both for the public upload and for an approved targeted transfer.
 */
export function sendFiles(url, files, { onSuccess, onFailure } = {}) {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));

  // XMLHttpRequest is used (instead of fetch) because it reports progress.
  const xhr = new XMLHttpRequest();
  xhr.open('POST', url);

  progressWrap.hidden = false;
  progressFill.style.width = '0%';
  progressLabel.textContent = '0%';
  uploadBtn.disabled = true;
  clearBtn.disabled = true;

  xhr.upload.addEventListener('progress', (e) => {
    if (!e.lengthComputable) return;
    const percent = Math.round((e.loaded / e.total) * 100);
    progressFill.style.width = `${percent}%`;
    progressLabel.textContent = `${percent}%`;
  });

  xhr.addEventListener('load', () => {
    uploadBtn.disabled = false;
    clearBtn.disabled = false;

    let data = {};
    try {
      data = JSON.parse(xhr.responseText);
    } catch {
      /* non-JSON response */
    }

    if (xhr.status >= 200 && xhr.status < 300 && data.success) {
      toast(data.message || 'Upload complete', 'success');
      state.selectedFiles = [];
      renderSelected();
      loadFiles();
      onSuccess?.(data);
    } else {
      toast(data.error || `Upload failed (${xhr.status})`, 'error');
      onFailure?.(data);
    }

    setTimeout(() => {
      progressWrap.hidden = true;
    }, 800);
  });

  xhr.addEventListener('error', () => {
    uploadBtn.disabled = false;
    clearBtn.disabled = false;
    progressWrap.hidden = true;
    toast('Network error during upload', 'error');
    onFailure?.();
  });

  xhr.send(formData);
}

/**
 * Ask a device for permission. Only the file names/sizes/types travel now -
 * the actual bytes stay in this tab until the other side approves.
 */
export async function requestTransfer(target) {
  uploadBtn.disabled = true;
  try {
    const { ok, data } = await api.createOffer(
      target,
      state.selectedFiles.map((f) => ({ name: f.name, size: f.size, type: f.type }))
    );
    if (!ok || !data.success) throw new Error(data.error || 'Could not send the request');

    // Hold on to the exact File objects so we can upload them on approval.
    state.pendingSend = { offerId: data.offer.id, files: state.selectedFiles.slice() };
    toast(`Waiting for ${data.offer.toName} to approve\u2026`, 'info');
    loadOffers();
  } catch (err) {
    toast(err.message || 'Could not send the request', 'error');
  } finally {
    uploadBtn.disabled = false;
  }
}

export function initUpload() {
  uploadBtn.addEventListener('click', () => {
    if (state.selectedFiles.length === 0) return;

    const target = targetSelect.value;
    if (target) {
      requestTransfer(target); // approval first, bytes later
    } else {
      sendFiles('/api/upload', state.selectedFiles); // shared with everyone
    }
  });
}
