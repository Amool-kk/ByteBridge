/**
 * Everything the UI mutates, in one place.
 *
 * This is a single exported object rather than seven `let` bindings because
 * ES module exports are read-only for importers: `import { x }` then `x = 1`
 * throws. Mutating a property of a shared object works everywhere.
 */

export const state = {
  selectedFiles: [], // files chosen but not uploaded yet
  allFiles: [], // files currently on the server
  myDeviceId: null, // this browser's id, from the server
  devices: [], // other devices currently online
  incoming: [], // offers waiting for my approval
  outgoing: [], // offers I sent that are still in flight
  pendingSend: null, // { offerId, files } - bytes held until approval
};
