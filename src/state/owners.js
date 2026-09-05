/**
 * File ownership - who is allowed to see which upload.
 *
 * owners: filename -> { from, to, at }
 *   `to === null`  -> shared with everyone
 *   `to === <id>`  -> only the sender and that one device may see/download it
 * Files on disk with no record (e.g. copied in manually) count as public.
 */

import fs, { promises as fsp } from 'fs';

import { META_FILE } from '../config.js';

// A stable `const` binding: `loadOwners` refills this Map rather than
// replacing it, so importers never end up holding a stale reference.
export const owners = new Map();

export function loadOwners() {
  owners.clear();
  try {
    const raw = fs.readFileSync(META_FILE, 'utf8');
    for (const [name, record] of Object.entries(JSON.parse(raw))) {
      owners.set(name, record);
    }
  } catch {
    // First run, or an unreadable file: start with an empty map.
  }
}

let saveTimer = null;

const serialise = () => JSON.stringify(Object.fromEntries(owners), null, 2);

/** Debounced atomic write, so a burst of uploads only writes once. */
export function saveOwners() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      const tmp = `${META_FILE}.tmp`;
      await fsp.writeFile(tmp, serialise());
      await fsp.rename(tmp, META_FILE); // rename is atomic
    } catch (err) {
      console.error('Could not save file ownership:', err);
    }
  }, 200);
}

/**
 * Write any pending change immediately, synchronously.
 *
 * Called on shutdown: without this, quitting within the debounce window
 * loses the record and a privately-sent file silently becomes public to
 * everyone on the network.
 */
export function flushOwners() {
  if (saveTimer === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    const tmp = `${META_FILE}.tmp`;
    fs.writeFileSync(tmp, serialise());
    fs.renameSync(tmp, META_FILE);
  } catch (err) {
    console.error('Could not save file ownership:', err);
  }
}

/** May this device see / download / delete this file? */
export function canAccess(filename, deviceId) {
  const owner = owners.get(filename);
  if (!owner || owner.to === null) return true; // public
  return owner.to === deviceId || owner.from === deviceId;
}
