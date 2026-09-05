/**
 * Every call to the server lives here, so no other module builds a URL.
 *
 * Each function resolves to `{ ok, data }`: `ok` is the HTTP status check and
 * `data` the parsed JSON body, because some callers need to distinguish a
 * 4xx from a `{ success: false }` payload.
 */

async function request(url, options) {
  const res = await fetch(url, options);
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  return { ok: res.ok, data };
}

const asJson = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  info: () => request('/api/info'),

  listFiles: () => request('/api/files'),
  deleteFile: (name) => request(`/api/files/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  downloadUrl: (name) => `/api/download/${encodeURIComponent(name)}`,

  listDevices: () => request('/api/devices'),
  renameDevice: (name) => request('/api/devices/me', asJson({ name })),

  listOffers: () => request('/api/offers'),
  createOffer: (to, files) => request('/api/offers', asJson({ to, files })),
  respondToOffer: (id, action) =>
    request(`/api/offers/${encodeURIComponent(id)}/${action}`, { method: 'POST' }),
  cancelOffer: (id) => request(`/api/offers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  offerUploadUrl: (id) => `/api/offers/${encodeURIComponent(id)}/upload`,
};
