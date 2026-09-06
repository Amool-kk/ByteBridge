/**
 * Server-Sent Events (plain HTTP push - no WebSocket needed).
 *
 * This module owns the listener registry and knows nothing about devices,
 * files or offers, which keeps it at the bottom of the dependency graph.
 */

// listeners: deviceId -> Set<response>   (a device may have several tabs open)
export const listeners = new Map();

export function sseSend(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Push an event to every tab of one device. */
export function notify(deviceId, type, data = {}) {
  for (const res of listeners.get(deviceId) || []) sseSend(res, type, data);
}

/** Push an event to everyone (used when the device list changes). */
export function broadcast(type, data = {}) {
  for (const set of listeners.values()) {
    for (const res of set) sseSend(res, type, data);
  }
}
