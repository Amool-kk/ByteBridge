/**
 * Everything that touches the uploads folder: listing, public upload,
 * download and delete.
 */

import path from 'path';
import { promises as fsp } from 'fs';
import { Router } from 'express';

import { UPLOAD_DIR } from '../config.js';
import { resolveInsideUploads } from '../lib/files.js';
import { owners, canAccess, saveOwners } from '../state/owners.js';
import { deviceName } from '../state/devices.js';
import { broadcast } from '../state/sse.js';
import { uploadFiles, sendUploadError } from '../middleware/upload.js';

const router = Router();

/** GET /api/files -> files this device is allowed to see */
router.get('/files', async (req, res, next) => {
  try {
    const entries = await fsp.readdir(UPLOAD_DIR, { withFileTypes: true });

    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
        .filter((entry) => canAccess(entry.name, req.deviceId))
        .map(async (entry) => {
          const stats = await fsp.stat(path.join(UPLOAD_DIR, entry.name));
          const owner = owners.get(entry.name);
          return {
            name: entry.name,
            size: stats.size,
            uploadedAt: stats.mtime.toISOString(),
            // `private` drives the badge in the UI.
            private: !!(owner && owner.to !== null),
            fromName: owner ? deviceName(owner.from) : null,
            toName: owner && owner.to ? deviceName(owner.to) : null,
            sentByMe: !!(owner && owner.from === req.deviceId),
          };
        })
    );

    // Newest first.
    files.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    res.json({ success: true, count: files.length, files });
  } catch (err) {
    next(err);
  }
});

/** POST /api/upload -> share one or many files with everyone (field: "files") */
router.post('/upload', (req, res) => {
  uploadFiles(req, res, (err) => {
    if (err) return sendUploadError(res, err);

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files were provided.' });
    }

    const uploaded = req.files.map((f) => ({
      name: f.filename,
      size: f.size,
      uploadedAt: new Date().toISOString(),
    }));

    // No ownership record = visible to everyone on the network.
    broadcast('files:changed');

    res.status(201).json({
      success: true,
      message: `${uploaded.length} file(s) uploaded.`,
      files: uploaded,
    });
  });
});

/** GET /api/download/:filename -> stream a file back as an attachment */
router.get('/download/:filename', async (req, res, next) => {
  const fullPath = resolveInsideUploads(req.params.filename);
  if (!fullPath) {
    return res.status(400).json({ success: false, error: 'Invalid file name.' });
  }

  try {
    const stats = await fsp.stat(fullPath);
    if (!stats.isFile()) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }

    // 404 rather than 403: don't reveal that someone else's file exists.
    if (!canAccess(path.basename(fullPath), req.deviceId)) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }

    // Force a download instead of letting the browser render/execute the file.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.download(fullPath, path.basename(fullPath), (err) => {
      if (err && !res.headersSent) next(err);
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }
    next(err);
  }
});

/** DELETE /api/files/:filename -> remove a file from uploads/ */
router.delete('/files/:filename', async (req, res, next) => {
  const fullPath = resolveInsideUploads(req.params.filename);
  if (!fullPath) {
    return res.status(400).json({ success: false, error: 'Invalid file name.' });
  }

  try {
    const stats = await fsp.stat(fullPath);
    if (!stats.isFile()) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }

    const name = path.basename(fullPath);
    if (!canAccess(name, req.deviceId)) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }

    await fsp.unlink(fullPath);
    owners.delete(name);
    saveOwners();
    broadcast('files:changed');
    res.json({ success: true, message: 'File deleted.', name });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }
    next(err);
  }
});

export default router;
