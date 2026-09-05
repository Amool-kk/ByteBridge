/* ==========================================================================
   Local File Share - frontend logic (vanilla JavaScript)
   Handles: drag & drop, file selection, upload with progress,
            listing / searching / downloading / deleting files.
   ========================================================================== */

// ---------------------------------------------------------------- Elements
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const selectedList = document.getElementById('selectedList');
const uploadActions = document.getElementById('uploadActions');
const uploadBtn = document.getElementById('uploadBtn');
const clearBtn = document.getElementById('clearBtn');
const progressWrap = document.getElementById('progressWrap');
const progressFill = document.getElementById('progressFill');
const progressLabel = document.getElementById('progressLabel');
const fileListEl = document.getElementById('fileList');
const emptyState = document.getElementById('emptyState');
const fileCountEl = document.getElementById('fileCount');
const searchInput = document.getElementById('searchInput');
const refreshBtn = document.getElementById('refreshBtn');
const serverUrlEl = document.getElementById('serverUrl');
const copyUrlBtn = document.getElementById('copyUrlBtn');
const qrImage = document.getElementById('qrImage');
const maxSizeEl = document.getElementById('maxSize');
const toasts = document.getElementById('toasts');
const deviceListEl = document.getElementById('deviceList');
const deviceCountEl = document.getElementById('deviceCount');
const devicesEmpty = document.getElementById('devicesEmpty');
const deviceNameInput = document.getElementById('deviceNameInput');
const targetSelect = document.getElementById('targetSelect');
const targetHint = document.getElementById('targetHint');
const requestsCard = document.getElementById('requestsCard');
const requestListEl = document.getElementById('requestList');

// ------------------------------------------------------------------ State
let selectedFiles = []; // files chosen but not uploaded yet
let allFiles = []; // files currently on the server
let myDeviceId = null; // this browser's id, from the server
let devices = []; // other devices currently online
let incoming = []; // offers waiting for my approval
let outgoing = []; // offers I sent that are still in flight
let pendingSend = null; // { offerId, files } - bytes held until approval

// ------------------------------------------------------------- Utilities

/** 1536 -> "1.5 KB" */
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** ISO date -> "5 Sep 2026, 14:32" */
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Pick an emoji icon based on the file extension. */
function iconFor(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = {
    // images
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️', bmp: '🖼️', heic: '🖼️',
    // video
    mp4: '🎬', mkv: '🎬', mov: '🎬', avi: '🎬', webm: '🎬',
    // audio
    mp3: '🎵', wav: '🎵', flac: '🎵', m4a: '🎵', ogg: '🎵',
    // documents
    pdf: '📕', doc: '📘', docx: '📘', txt: '📄', md: '📝', rtf: '📄',
    xls: '📊', xlsx: '📊', csv: '📊', ppt: '📙', pptx: '📙',
    // archives
    zip: '🗜️', rar: '🗜️', '7z': '🗜️', tar: '🗜️', gz: '🗜️',
    // code
    js: '💻', ts: '💻', jsx: '💻', tsx: '💻', html: '💻', css: '💻',
    json: '💻', py: '💻', java: '💻', c: '💻', cpp: '💻', sh: '💻',
    // apps
    exe: '⚙️', dmg: '⚙️', apk: '🤖', iso: '💿',
  };
  return map[ext] || '📄';
}

/** Show a small notification in the bottom-right corner. */
function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message;
  toasts.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ------------------------------------------------- Server info + QR code
async function loadServerInfo() {
  try {
    const res = await fetch('/api/info');
    const data = await res.json();
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

copyUrlBtn.addEventListener('click', async () => {
  const url = serverUrlEl.textContent.trim();
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied to clipboard', 'success');
  } catch {
    toast('Copy failed — select the link manually', 'error');
  }
});

// -------------------------------------------------------- File selection

/** Add files to the pending list (skipping exact duplicates). */
function addFiles(fileArray) {
  for (const file of fileArray) {
    const duplicate = selectedFiles.some(
      (f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified
    );
    if (!duplicate) selectedFiles.push(file);
  }
  renderSelected();
}

function renderSelected() {
  selectedList.innerHTML = '';

  selectedFiles.forEach((file, index) => {
    const li = document.createElement('li');
    li.className = 'selected__item';

    const icon = document.createElement('span');
    icon.textContent = iconFor(file.name);

    const name = document.createElement('span');
    name.className = 'selected__name';
    name.textContent = file.name; // textContent -> no HTML injection

    const size = document.createElement('span');
    size.className = 'selected__size';
    size.textContent = formatSize(file.size);

    const remove = document.createElement('button');
    remove.className = 'icon-btn';
    remove.type = 'button';
    remove.title = 'Remove';
    remove.textContent = '✕';
    remove.addEventListener('click', () => {
      selectedFiles.splice(index, 1);
      renderSelected();
    });

    li.append(icon, name, size, remove);
    selectedList.appendChild(li);
  });

  uploadActions.hidden = selectedFiles.length === 0;
  updateTargetHint();
}

/** Explain what the Upload button will actually do. */
function updateTargetHint() {
  const target = targetSelect.value;
  if (!target || selectedFiles.length === 0) {
    targetHint.hidden = true;
    uploadBtn.textContent = 'Upload';
    return;
  }
  const name = devices.find((d) => d.id === target)?.name || 'that device';
  targetHint.hidden = false;
  targetHint.textContent =
    `${name} will be asked to approve first. Nothing is sent until they accept, ` +
    'so keep this tab open.';
  uploadBtn.textContent = 'Send request';
}

// Click / keyboard on the dropzone opens the file picker.
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener('change', () => {
  addFiles(Array.from(fileInput.files));
  fileInput.value = ''; // allow re-selecting the same file
});

// Drag & drop handling.
['dragenter', 'dragover'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('is-dragover');
  })
);

['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
  })
);

dropzone.addEventListener('drop', (e) => {
  if (e.dataTransfer?.files?.length) addFiles(Array.from(e.dataTransfer.files));
});

// Prevent the browser from opening a file dropped outside the dropzone.
['dragover', 'drop'].forEach((evt) =>
  window.addEventListener(evt, (e) => {
    if (!dropzone.contains(e.target)) e.preventDefault();
  })
);

clearBtn.addEventListener('click', () => {
  selectedFiles = [];
  renderSelected();
});

// ---------------------------------------------------------------- Upload

/**
 * Upload the given files to `url` with a progress bar.
 * Used both for the public upload and for an approved targeted transfer.
 */
function sendFiles(url, files, { onSuccess, onFailure } = {}) {
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
      selectedFiles = [];
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
async function requestTransfer(target) {
  uploadBtn.disabled = true;
  try {
    const res = await fetch('/api/offers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: target,
        files: selectedFiles.map((f) => ({
          name: f.name,
          size: f.size,
          type: f.type,
        })),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Could not send the request');

    // Hold on to the exact File objects so we can upload them on approval.
    pendingSend = { offerId: data.offer.id, files: selectedFiles.slice() };
    toast(`Waiting for ${data.offer.toName} to approve\u2026`, 'info');
    loadOffers();
  } catch (err) {
    toast(err.message || 'Could not send the request', 'error');
  } finally {
    uploadBtn.disabled = false;
  }
}

uploadBtn.addEventListener('click', () => {
  if (selectedFiles.length === 0) return;

  const target = targetSelect.value;
  if (target) {
    requestTransfer(target); // approval first, bytes later
  } else {
    sendFiles('/api/upload', selectedFiles); // shared with everyone
  }
});

// ------------------------------------------------------------- File list
async function loadFiles() {
  try {
    const res = await fetch('/api/files');
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to load files');
    allFiles = data.files;
    renderFiles();
  } catch (err) {
    toast(err.message || 'Could not load files', 'error');
  }
}

function renderFiles() {
  const query = searchInput.value.trim().toLowerCase();
  const visible = query
    ? allFiles.filter((f) => f.name.toLowerCase().includes(query))
    : allFiles;

  fileCountEl.textContent = allFiles.length;
  fileListEl.innerHTML = '';

  if (visible.length === 0) {
    emptyState.hidden = false;
    emptyState.textContent = query
      ? `No files match "${searchInput.value.trim()}".`
      : 'No files shared yet. Upload something to get started.';
    return;
  }
  emptyState.hidden = true;

  for (const file of visible) {
    fileListEl.appendChild(buildFileRow(file));
  }
}

function buildFileRow(file) {
  const row = document.createElement('div');
  row.className = 'file';

  const icon = document.createElement('div');
  icon.className = 'file__icon';
  icon.textContent = iconFor(file.name);

  const meta = document.createElement('div');
  meta.className = 'file__meta';

  const name = document.createElement('div');
  name.className = 'file__name';
  name.textContent = file.name;
  name.title = file.name;

  const sub = document.createElement('div');
  sub.className = 'file__sub';
  sub.textContent = `${formatSize(file.size)} · ${formatDate(file.uploadedAt)}`;

  meta.append(name, sub);

  // Mark files that were sent privately, so it's obvious they aren't public.
  if (file.private) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = file.sentByMe ? `🔒 sent to ${file.toName ?? 'a device'}` : `🔒 from ${file.fromName}`;
    sub.append(' · ', tag);
  }

  const actions = document.createElement('div');
  actions.className = 'file__actions';

  // Download: a normal link to the API endpoint.
  const download = document.createElement('a');
  download.className = 'btn btn--primary btn--sm';
  download.href = `/api/download/${encodeURIComponent(file.name)}`;
  download.textContent = 'Download';

  const del = document.createElement('button');
  del.className = 'btn btn--danger btn--sm';
  del.type = 'button';
  del.textContent = 'Delete';
  del.addEventListener('click', () => deleteFile(file.name, del));

  actions.append(download, del);
  row.append(icon, meta, actions);
  return row;
}

async function deleteFile(name, button) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

  button.disabled = true;
  try {
    const res = await fetch(`/api/files/${encodeURIComponent(name)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Delete failed');
    toast(`Deleted "${name}"`, 'success');
    loadFiles();
  } catch (err) {
    button.disabled = false;
    toast(err.message || 'Delete failed', 'error');
  }
}

// --------------------------------------------------------------- Devices
async function loadDevices() {
  try {
    const res = await fetch('/api/devices');
    const data = await res.json();
    if (!data.success) return;

    myDeviceId = data.you;
    devices = data.devices;
    renderDevices();
  } catch {
    /* offline; the next refresh will retry */
  }
}

function renderDevices() {
  const others = devices.filter((d) => !d.isYou);
  const me = devices.find((d) => d.isYou);

  deviceCountEl.textContent = devices.length;
  devicesEmpty.hidden = others.length > 0;
  deviceListEl.innerHTML = '';

  // Don't clobber what the user is currently typing.
  if (me && document.activeElement !== deviceNameInput) {
    deviceNameInput.value = me.name;
  }

  for (const device of devices) {
    const chip = document.createElement('div');
    chip.className = `device${device.isYou ? ' device--you' : ''}`;

    const dot = document.createElement('span');
    dot.className = 'device__dot';

    const name = document.createElement('span');
    name.className = 'device__name';
    name.textContent = device.name;

    chip.append(dot, name);

    if (device.isYou) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'this device';
      chip.append(tag);
    } else {
      // Clicking a device selects it as the upload target.
      const send = document.createElement('button');
      send.className = 'btn btn--ghost btn--sm';
      send.type = 'button';
      send.textContent = 'Send to';
      send.addEventListener('click', () => {
        targetSelect.value = device.id;
        updateTargetHint();
        dropzone.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      chip.append(send);
    }

    deviceListEl.appendChild(chip);
  }

  renderTargetOptions();
}

/** Keep the "Send to" dropdown in sync with who is online. */
function renderTargetOptions() {
  const previous = targetSelect.value;
  targetSelect.innerHTML = '';

  const everyone = document.createElement('option');
  everyone.value = '';
  everyone.textContent = 'Everyone on this network';
  targetSelect.appendChild(everyone);

  for (const device of devices) {
    if (device.isYou) continue;
    const option = document.createElement('option');
    option.value = device.id;
    option.textContent = `${device.name} (needs approval)`;
    targetSelect.appendChild(option);
  }

  // Keep the previous choice only if that device is still around.
  targetSelect.value = devices.some((d) => d.id === previous && !d.isYou) ? previous : '';
  updateTargetHint();
}

deviceNameInput.addEventListener('change', async () => {
  const name = deviceNameInput.value.trim();
  if (!name) return loadDevices(); // empty -> revert to the current name

  try {
    const res = await fetch('/api/devices/me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Rename failed');
    toast('Device renamed', 'success');
  } catch (err) {
    toast(err.message || 'Rename failed', 'error');
    loadDevices();
  }
});

targetSelect.addEventListener('change', updateTargetHint);

// -------------------------------------------------------------- Requests
async function loadOffers() {
  try {
    const res = await fetch('/api/offers');
    const data = await res.json();
    if (!data.success) return;
    incoming = data.incoming;
    outgoing = data.outgoing;
    renderOffers();
  } catch {
    /* ignore; SSE or the next poll will catch up */
  }
}

/** "1:59" remaining before an offer expires. */
function countdownText(expiresAt) {
  const left = Math.max(0, Math.round((new Date(expiresAt) - Date.now()) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

function renderOffers() {
  requestListEl.innerHTML = '';
  requestsCard.hidden = incoming.length === 0 && outgoing.length === 0;

  for (const offer of incoming) requestListEl.appendChild(buildIncoming(offer));
  for (const offer of outgoing) requestListEl.appendChild(buildOutgoing(offer));
}

/** Shared markup: who it's from/to, the file manifest, and a countdown. */
function buildRequestShell(offer, title) {
  const card = document.createElement('div');
  card.className = 'request';

  const head = document.createElement('div');
  head.className = 'request__head';

  const heading = document.createElement('div');
  heading.className = 'request__title';
  heading.textContent = title;

  const timer = document.createElement('span');
  timer.className = 'countdown';
  timer.dataset.expires = offer.expiresAt;
  timer.textContent = countdownText(offer.expiresAt);

  head.append(heading, timer);

  const list = document.createElement('ul');
  list.className = 'request__files';

  for (const file of offer.files) {
    const li = document.createElement('li');
    li.append(
      Object.assign(document.createElement('span'), { textContent: iconFor(file.name) }),
      Object.assign(document.createElement('span'), {
        className: 'request__name',
        textContent: file.name, // textContent -> no HTML injection
      }),
      Object.assign(document.createElement('span'), {
        className: 'request__size',
        textContent: formatSize(file.size),
      })
    );
    list.appendChild(li);
  }

  const total = document.createElement('p');
  total.className = 'request__total';
  total.textContent = `${offer.files.length} file(s) · ${formatSize(offer.totalSize)} total`;

  card.append(head, list, total);
  return card;
}

function buildIncoming(offer) {
  const card = buildRequestShell(offer, `${offer.fromName} wants to send you files`);
  card.classList.add('request--incoming');

  const actions = document.createElement('div');
  actions.className = 'request__actions';

  const approve = document.createElement('button');
  approve.className = 'btn btn--primary btn--sm';
  approve.type = 'button';
  approve.textContent = 'Approve';
  approve.addEventListener('click', () => respondToOffer(offer.id, 'approve', card));

  const decline = document.createElement('button');
  decline.className = 'btn btn--danger btn--sm';
  decline.type = 'button';
  decline.textContent = 'Decline';
  decline.addEventListener('click', () => respondToOffer(offer.id, 'decline', card));

  actions.append(approve, decline);
  card.appendChild(actions);
  return card;
}

function buildOutgoing(offer) {
  const label =
    offer.status === 'approved'
      ? `${offer.toName} approved — sending…`
      : `Waiting for ${offer.toName} to approve…`;

  const card = buildRequestShell(offer, label);
  card.classList.add('request--outgoing');

  if (offer.status === 'pending') {
    const actions = document.createElement('div');
    actions.className = 'request__actions';

    const cancel = document.createElement('button');
    cancel.className = 'btn btn--ghost btn--sm';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', async () => {
      cancel.disabled = true;
      await fetch(`/api/offers/${encodeURIComponent(offer.id)}`, { method: 'DELETE' });
      pendingSend = null;
      loadOffers();
    });

    actions.appendChild(cancel);
    card.appendChild(actions);
  }

  return card;
}

async function respondToOffer(id, action, card) {
  card.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    const res = await fetch(`/api/offers/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Could not respond');
    toast(action === 'approve' ? 'Approved — waiting for the files…' : 'Request declined', 'info');
  } catch (err) {
    toast(err.message || 'Could not respond', 'error');
  } finally {
    loadOffers();
  }
}

// Tick every countdown once a second without re-rendering the whole list.
setInterval(() => {
  for (const el of document.querySelectorAll('.countdown')) {
    el.textContent = countdownText(el.dataset.expires);
  }
}, 1000);

// ----------------------------------------------------------- Live events
// Server-Sent Events: plain HTTP, so it works over http://192.168.x.x with
// no extra dependency. If it fails we still have the polling fallback.
function connectEvents() {
  const source = new EventSource('/api/events');

  source.addEventListener('ready', (e) => {
    myDeviceId = JSON.parse(e.data).you;
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
    if (!pendingSend || pendingSend.offerId !== offer.id) return;

    const { files } = pendingSend;
    pendingSend = null;
    sendFiles(`/api/offers/${encodeURIComponent(offer.id)}/upload`, files);
  });

  for (const status of ['declined', 'cancelled', 'expired']) {
    source.addEventListener(`offer:${status}`, (e) => {
      const offer = JSON.parse(e.data);
      if (pendingSend?.offerId === offer.id) pendingSend = null;
      if (offer.from === myDeviceId) {
        toast(`${offer.toName} ${status} your transfer`, status === 'declined' ? 'error' : 'info');
      }
      loadOffers();
    });
  }

  source.addEventListener('offer:delivered', (e) => {
    const offer = JSON.parse(e.data);
    if (offer.to === myDeviceId) toast(`Received ${offer.files.length} file(s) from ${offer.fromName}`, 'success');
    loadOffers();
    loadFiles();
  });

  // EventSource reconnects on its own; just resync when it does.
  source.addEventListener('open', () => {
    loadDevices();
    loadOffers();
  });
}

// -------------------------------------------------------------- Wiring up
searchInput.addEventListener('input', renderFiles);
refreshBtn.addEventListener('click', loadFiles);

// Initial load + light auto-refresh so devices see each other's uploads.
loadServerInfo();
loadFiles();
loadDevices();
loadOffers();
connectEvents();
setInterval(loadFiles, 10000);
setInterval(loadDevices, 10000);
