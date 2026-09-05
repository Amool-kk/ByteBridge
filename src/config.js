/**
 * Every tunable value lives here so nothing else has to guess a path or limit.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// This file sits in <root>/src, so the project root is one level up.
// ES modules have no __dirname, and resolving relative to this file (rather
// than process.cwd()) means `npm start` works from any directory.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PORT = Number(process.env.PORT) || 3000;
export const HOST = '0.0.0.0'; // listen on every network interface -> reachable on LAN

export const PUBLIC_DIR = path.join(ROOT, 'public');
export const UPLOAD_DIR = path.join(ROOT, 'uploads');

export const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB per file
export const MAX_FILES_PER_REQUEST = 20;

// Where we remember which device owns which file (so targeted files stay
// private across restarts). The leading dot keeps it out of the file listing.
export const META_FILE = path.join(UPLOAD_DIR, '.meta.json');

// A device is "online" if we heard from it within this window.
export const DEVICE_TTL = 15_000;
export const DEVICE_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days
export const MAX_SSE_PER_DEVICE = 5; // tabs open per device

// A send request the receiver never answers is dropped after this long.
export const OFFER_TTL = 120_000;
export const MAX_PENDING_OFFERS_PER_DEVICE = 5;

// Create the uploads directory on startup if it is missing.
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
