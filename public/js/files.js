/**
 * The shared file list: loading, searching, rendering and deleting.
 */

import { state } from './state.js';
import { fileListEl, emptyState, fileCountEl, searchInput } from './dom.js';
import { api } from './api.js';
import { formatSize, formatDate, iconFor, toast } from './util.js';

export async function loadFiles() {
  try {
    const { data } = await api.listFiles();
    if (!data.success) throw new Error(data.error || 'Failed to load files');
    state.allFiles = data.files;
    renderFiles();
  } catch (err) {
    toast(err.message || 'Could not load files', 'error');
  }
}

export function renderFiles() {
  const query = searchInput.value.trim().toLowerCase();
  const visible = query
    ? state.allFiles.filter((f) => f.name.toLowerCase().includes(query))
    : state.allFiles;

  fileCountEl.textContent = state.allFiles.length;
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
  download.href = api.downloadUrl(file.name);
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
    const { ok, data } = await api.deleteFile(name);
    if (!ok || !data.success) throw new Error(data.error || 'Delete failed');
    toast(`Deleted "${name}"`, 'success');
    loadFiles();
  } catch (err) {
    button.disabled = false;
    toast(err.message || 'Delete failed', 'error');
  }
}
