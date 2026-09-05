/**
 * Choosing what to send: the dropzone, the pending list, and the hint that
 * explains what the button will actually do.
 */

import { state } from './state.js';
import {
  dropzone,
  fileInput,
  selectedList,
  uploadActions,
  uploadBtn,
  clearBtn,
  targetSelect,
  targetHint,
} from './dom.js';
import { formatSize, iconFor } from './util.js';

/** Add files to the pending list (skipping exact duplicates). */
export function addFiles(fileArray) {
  for (const file of fileArray) {
    const duplicate = state.selectedFiles.some(
      (f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified
    );
    if (!duplicate) state.selectedFiles.push(file);
  }
  renderSelected();
}

export function clearSelection() {
  state.selectedFiles = [];
  renderSelected();
}

export function renderSelected() {
  selectedList.innerHTML = '';

  state.selectedFiles.forEach((file, index) => {
    const li = document.createElement('li');
    li.className = 'selected__item';

    const icon = document.createElement('span');
    icon.textContent = iconFor(file.name);

    const name = document.createElement('span');
    name.className = 'selected__name';
    name.textContent = file.name; // textContent -> no HTML injection

    const size = document.createElement('span');
    size.className = 'selected__size';
    size.textContent = formatSize(file.size);

    const remove = document.createElement('button');
    remove.className = 'icon-btn';
    remove.type = 'button';
    remove.title = 'Remove';
    remove.textContent = '✕';
    remove.addEventListener('click', () => {
      state.selectedFiles.splice(index, 1);
      renderSelected();
    });

    li.append(icon, name, size, remove);
    selectedList.appendChild(li);
  });

  uploadActions.hidden = state.selectedFiles.length === 0;
  updateTargetHint();
}

/** Explain what the Upload button will actually do. */
export function updateTargetHint() {
  const target = targetSelect.value;
  if (!target || state.selectedFiles.length === 0) {
    targetHint.hidden = true;
    uploadBtn.textContent = 'Upload';
    return;
  }
  const name = state.devices.find((d) => d.id === target)?.name || 'that device';
  targetHint.hidden = false;
  targetHint.textContent =
    `${name} will be asked to approve first. Nothing is sent until they accept, ` +
    'so keep this tab open.';
  uploadBtn.textContent = 'Send request';
}

export function initSelection() {
  // Click / keyboard on the dropzone opens the file picker.
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', () => {
    addFiles(Array.from(fileInput.files));
    fileInput.value = ''; // allow re-selecting the same file
  });

  // Drag & drop handling.
  ['dragenter', 'dragover'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('is-dragover');
    })
  );

  ['dragleave', 'drop'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('is-dragover');
    })
  );

  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) addFiles(Array.from(e.dataTransfer.files));
  });

  // Prevent the browser from opening a file dropped outside the dropzone.
  ['dragover', 'drop'].forEach((evt) =>
    window.addEventListener(evt, (e) => {
      if (!dropzone.contains(e.target)) e.preventDefault();
    })
  );

  clearBtn.addEventListener('click', clearSelection);
}
