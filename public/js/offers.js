/**
 * The approval cards: incoming requests waiting on me, and my own requests
 * still in flight.
 */

import { state } from './state.js';
import { requestsCard, requestListEl } from './dom.js';
import { api } from './api.js';
import { formatSize, iconFor, toast, countdownText } from './util.js';

export async function loadOffers() {
  try {
    const { data } = await api.listOffers();
    if (!data.success) return;
    state.incoming = data.incoming;
    state.outgoing = data.outgoing;
    renderOffers();
  } catch {
    /* ignore; SSE or the next poll will catch up */
  }
}

function renderOffers() {
  requestListEl.innerHTML = '';
  requestsCard.hidden = state.incoming.length === 0 && state.outgoing.length === 0;

  for (const offer of state.incoming) requestListEl.appendChild(buildIncoming(offer));
  for (const offer of state.outgoing) requestListEl.appendChild(buildOutgoing(offer));
}

/** Shared markup: who it's from/to, the file manifest, and a countdown. */
function buildRequestShell(offer, title) {
  const card = document.createElement('div');
  card.className = 'request';

  const head = document.createElement('div');
  head.className = 'request__head';

  const heading = document.createElement('div');
  heading.className = 'request__title';
  heading.textContent = title;

  const timer = document.createElement('span');
  timer.className = 'countdown';
  timer.dataset.expires = offer.expiresAt;
  timer.textContent = countdownText(offer.expiresAt);

  head.append(heading, timer);

  const list = document.createElement('ul');
  list.className = 'request__files';

  for (const file of offer.files) {
    const li = document.createElement('li');
    li.append(
      Object.assign(document.createElement('span'), { textContent: iconFor(file.name) }),
      Object.assign(document.createElement('span'), {
        className: 'request__name',
        textContent: file.name, // textContent -> no HTML injection
      }),
      Object.assign(document.createElement('span'), {
        className: 'request__size',
        textContent: formatSize(file.size),
      })
    );
    list.appendChild(li);
  }

  const total = document.createElement('p');
  total.className = 'request__total';
  total.textContent = `${offer.files.length} file(s) · ${formatSize(offer.totalSize)} total`;

  card.append(head, list, total);
  return card;
}

function buildIncoming(offer) {
  const card = buildRequestShell(offer, `${offer.fromName} wants to send you files`);
  card.classList.add('request--incoming');

  const actions = document.createElement('div');
  actions.className = 'request__actions';

  const approve = document.createElement('button');
  approve.className = 'btn btn--primary btn--sm';
  approve.type = 'button';
  approve.textContent = 'Approve';
  approve.addEventListener('click', () => respondToOffer(offer.id, 'approve', card));

  const decline = document.createElement('button');
  decline.className = 'btn btn--danger btn--sm';
  decline.type = 'button';
  decline.textContent = 'Decline';
  decline.addEventListener('click', () => respondToOffer(offer.id, 'decline', card));

  actions.append(approve, decline);
  card.appendChild(actions);
  return card;
}

function buildOutgoing(offer) {
  const label =
    offer.status === 'approved'
      ? `${offer.toName} approved — sending…`
      : `Waiting for ${offer.toName} to approve…`;

  const card = buildRequestShell(offer, label);
  card.classList.add('request--outgoing');

  if (offer.status === 'pending') {
    const actions = document.createElement('div');
    actions.className = 'request__actions';

    const cancel = document.createElement('button');
    cancel.className = 'btn btn--ghost btn--sm';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', async () => {
      cancel.disabled = true;
      await api.cancelOffer(offer.id);
      state.pendingSend = null;
      loadOffers();
    });

    actions.appendChild(cancel);
    card.appendChild(actions);
  }

  return card;
}

async function respondToOffer(id, action, card) {
  card.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    const { ok, data } = await api.respondToOffer(id, action);
    if (!ok || !data.success) throw new Error(data.error || 'Could not respond');
    toast(action === 'approve' ? 'Approved — waiting for the files…' : 'Request declined', 'info');
  } catch (err) {
    toast(err.message || 'Could not respond', 'error');
  } finally {
    loadOffers();
  }
}

export function initOffers() {
  // Tick every countdown once a second without re-rendering the whole list.
  setInterval(() => {
    for (const el of document.querySelectorAll('.countdown')) {
      el.textContent = countdownText(el.dataset.expires);
    }
  }, 1000);
}
