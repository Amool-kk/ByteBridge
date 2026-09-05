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

// ------------------------------------------------------------------ State
let selectedFiles = []; // files chosen but not uploaded yet
let allFiles = []; // files currently on the server

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
    maxSizeEl.textContent = data.maxFileSizeMb;
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
uploadBtn.addEventListener('click', () => {
  if (selectedFiles.length === 0) return;

  const formData = new FormData();
  selectedFiles.forEach((file) => formData.append('files', file));

  // XMLHttpRequest is used (instead of fetch) because it reports progress.
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');

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
    } else {
      toast(data.error || `Upload failed (${xhr.status})`, 'error');
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
  });

  xhr.send(formData);
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

// -------------------------------------------------------------- Wiring up
searchInput.addEventListener('input', renderFiles);
refreshBtn.addEventListener('click', loadFiles);

// Initial load + light auto-refresh so devices see each other's uploads.
loadServerInfo();
loadFiles();
setInterval(loadFiles, 10000);
