/**
 * Multer setup (handles multipart/form-data uploads) plus the shared error
 * translation used by both upload routes.
 */

import multer from 'multer';

import { UPLOAD_DIR, MAX_FILE_SIZE, MAX_FILES_PER_REQUEST } from '../config.js';
import { sanitizeFilename, uniqueFilename } from '../lib/files.js';
import { formatBytes } from '../lib/format.js';

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  async filename(req, file, cb) {
    try {
      // Browsers may send latin1-decoded names; re-decode as UTF-8.
      const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const safe = sanitizeFilename(decoded);
      cb(null, await uniqueFilename(safe));
    } catch (err) {
      cb(err);
    }
  },
});

export const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES_PER_REQUEST,
  },
});

/** The `files` field, capped - the only form shape either route accepts. */
export const uploadFiles = upload.array('files', MAX_FILES_PER_REQUEST);

/**
 * Turn a Multer failure into a friendly JSON response.
 * Shared by the public upload route and the approved-offer upload route.
 */
export function sendUploadError(res, err) {
  if (err instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: `File is too large. Maximum size is ${formatBytes(MAX_FILE_SIZE)}.`,
      LIMIT_FILE_COUNT: `Too many files. Maximum is ${MAX_FILES_PER_REQUEST} per upload.`,
      LIMIT_UNEXPECTED_FILE: 'Unexpected form field. Use the field name "files".',
    };
    return res.status(413).json({
      success: false,
      error: messages[err.code] || `Upload error: ${err.code}`,
    });
  }
  console.error('Upload failed:', err);
  return res.status(500).json({ success: false, error: 'Upload failed.' });
}
