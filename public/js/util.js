/**
 * Small pure-ish helpers: formatting and the toast notifications.
 */

import { toasts } from './dom.js';

/** 1536 -> "1.5 KB" */
export function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** ISO date -> "5 Sep 2026, 14:32" */
export function formatDate(iso) {
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
export function iconFor(name) {
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
export function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message;
  toasts.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/** "1:59" remaining before an offer expires. */
export function countdownText(expiresAt) {
  const left = Math.max(0, Math.round((new Date(expiresAt) - Date.now()) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}
