/**
 * Every element the app touches, looked up once.
 *
 * Safe at import time: the page loads this as a module, which is deferred,
 * so the DOM is already parsed.
 */

const byId = (id) => document.getElementById(id);

// Upload area
export const dropzone = byId('dropzone');
export const fileInput = byId('fileInput');
export const selectedList = byId('selectedList');
export const uploadActions = byId('uploadActions');
export const uploadBtn = byId('uploadBtn');
export const clearBtn = byId('clearBtn');
export const targetSelect = byId('targetSelect');
export const targetHint = byId('targetHint');

// Progress
export const progressWrap = byId('progressWrap');
export const progressFill = byId('progressFill');
export const progressLabel = byId('progressLabel');

// File list
export const fileListEl = byId('fileList');
export const emptyState = byId('emptyState');
export const fileCountEl = byId('fileCount');
export const searchInput = byId('searchInput');
export const refreshBtn = byId('refreshBtn');

// Header / server info
export const serverUrlEl = byId('serverUrl');
export const copyUrlBtn = byId('copyUrlBtn');
export const qrImage = byId('qrImage');
export const maxSizeEl = byId('maxSize');

// Devices
export const deviceListEl = byId('deviceList');
export const deviceCountEl = byId('deviceCount');
export const devicesEmpty = byId('devicesEmpty');
export const deviceNameInput = byId('deviceNameInput');

// Requests
export const requestsCard = byId('requestsCard');
export const requestListEl = byId('requestList');

// Toasts
export const toasts = byId('toasts');
