/**
 * Local File Share - frontend entry point.
 *
 * Wires the modules together: attach listeners, do the first load, then keep
 * things fresh over Server-Sent Events with a slow poll as a fallback.
 */

import { searchInput, refreshBtn } from './dom.js';
import { loadServerInfo, initInfo } from './info.js';
import { initSelection } from './selection.js';
import { initUpload } from './upload.js';
import { loadFiles, renderFiles } from './files.js';
import { loadDevices, initDevices } from './devices.js';
import { loadOffers, initOffers } from './offers.js';
import { connectEvents } from './events.js';

initInfo();
initSelection();
initUpload();
initDevices();
initOffers();

searchInput.addEventListener('input', renderFiles);
refreshBtn.addEventListener('click', loadFiles);

// Initial load + light auto-refresh so devices see each other's uploads.
loadServerInfo();
loadFiles();
loadDevices();
loadOffers();
connectEvents();
setInterval(loadFiles, 10000);
setInterval(loadDevices, 10000);
