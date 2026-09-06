/**
 * Who else is on the network: the device chips, renaming this one, and
 * keeping the "Send to" picker in sync.
 */

import { state } from './state.js';
import {
  deviceListEl,
  deviceCountEl,
  devicesEmpty,
  deviceNameInput,
  targetSelect,
  dropzone,
} from './dom.js';
import { api } from './api.js';
import { toast } from './util.js';
import { updateTargetHint } from './selection.js';

export async function loadDevices() {
  try {
    const { data } = await api.listDevices();
    if (!data.success) return;

    state.myDeviceId = data.you;
    state.devices = data.devices;
    renderDevices();
  } catch {
    /* offline; the next refresh will retry */
  }
}

function renderDevices() {
  const others = state.devices.filter((d) => !d.isYou);
  const me = state.devices.find((d) => d.isYou);

  deviceCountEl.textContent = state.devices.length;
  devicesEmpty.hidden = others.length > 0;
  deviceListEl.innerHTML = '';

  // Don't clobber what the user is currently typing.
  if (me && document.activeElement !== deviceNameInput) {
    deviceNameInput.value = me.name;
  }

  for (const device of state.devices) {
    const chip = document.createElement('div');
    chip.className = `device${device.isYou ? ' device--you' : ''}`;

    const dot = document.createElement('span');
    dot.className = 'device__dot';

    const name = document.createElement('span');
    name.className = 'device__name';
    name.textContent = device.name;

    chip.append(dot, name);

    if (device.isYou) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'this device';
      chip.append(tag);
    } else {
      // Clicking a device selects it as the upload target.
      const send = document.createElement('button');
      send.className = 'btn btn--ghost btn--sm';
      send.type = 'button';
      send.textContent = 'Send to';
      send.addEventListener('click', () => {
        targetSelect.value = device.id;
        updateTargetHint();
        dropzone.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      chip.append(send);
    }

    deviceListEl.appendChild(chip);
  }

  renderTargetOptions();
}

/** Keep the "Send to" dropdown in sync with who is online. */
function renderTargetOptions() {
  const previous = targetSelect.value;
  targetSelect.innerHTML = '';

  const everyone = document.createElement('option');
  everyone.value = '';
  everyone.textContent = 'Everyone on this network';
  targetSelect.appendChild(everyone);

  for (const device of state.devices) {
    if (device.isYou) continue;
    const option = document.createElement('option');
    option.value = device.id;
    option.textContent = `${device.name} (needs approval)`;
    targetSelect.appendChild(option);
  }

  // Keep the previous choice only if that device is still around.
  targetSelect.value = state.devices.some((d) => d.id === previous && !d.isYou) ? previous : '';
  updateTargetHint();
}

export function initDevices() {
  deviceNameInput.addEventListener('change', async () => {
    const name = deviceNameInput.value.trim();
    if (!name) return loadDevices(); // empty -> revert to the current name

    try {
      const { ok, data } = await api.renameDevice(name);
      if (!ok || !data.success) throw new Error(data.error || 'Rename failed');
      toast('Device renamed', 'success');
    } catch (err) {
      toast(err.message || 'Rename failed', 'error');
      loadDevices();
    }
  });

  targetSelect.addEventListener('change', updateTargetHint);
}
