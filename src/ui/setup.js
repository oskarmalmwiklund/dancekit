import { getClientId, setClientId, getRedirectUri, beginLogin } from '../spotify/auth.js';

const $ = (id) => document.getElementById(id);

export function showConnectStep(errorMessage = null) {
  $('screen-setup').hidden = false;
  $('step-connect').hidden = false;
  $('step-playlists').hidden = true;
  $('redirect-uri').textContent = getRedirectUri();
  $('client-id').value = getClientId();

  const errEl = $('connect-error');
  errEl.hidden = !errorMessage;
  if (errorMessage) errEl.textContent = errorMessage;

  $('btn-connect').onclick = () => {
    const id = $('client-id').value.trim();
    if (!id) {
      errEl.hidden = false;
      errEl.textContent = 'Paste your Spotify app Client ID first.';
      return;
    }
    setClientId(id);
    beginLogin();
  };
}

// listPlaylists: () => Promise<[{id,name,total,image}]>
// onStart: (playlistIds, reportProgress) => Promise<void>
export async function showPlaylistStep({ listPlaylists, onStart }) {
  $('screen-setup').hidden = false;
  $('step-connect').hidden = true;
  $('step-playlists').hidden = false;

  const listEl = $('playlist-list');
  const btn = $('btn-analyze');
  const progressEl = $('analyze-progress');
  const errEl = $('playlist-error');
  const selected = new Set();

  let playlists;
  try {
    playlists = await listPlaylists();
  } catch (e) {
    listEl.innerHTML = '';
    errEl.hidden = false;
    errEl.textContent = `Could not load playlists: ${e.message}`;
    return;
  }

  listEl.innerHTML = '';
  for (const p of playlists) {
    const item = document.createElement('label');
    item.className = 'playlist-item';
    item.innerHTML = `
      <input type="checkbox" value="${p.id}">
      ${p.image ? `<img src="${p.image}" alt="">` : '<span style="width:36px"></span>'}
      <span>${escapeHtml(p.name)}</span>
      <span class="count">${p.total != null ? `${p.total} tracks` : ''}</span>`;
    item.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) selected.add(p);
      else selected.delete(p);
      btn.disabled = selected.size === 0;
    });
    listEl.appendChild(item);
  }

  btn.onclick = async () => {
    btn.disabled = true;
    errEl.hidden = true;
    try {
      await onStart(Array.from(selected), (msg) => {
        progressEl.textContent = msg;
      });
    } catch (e) {
      errEl.hidden = false;
      errEl.textContent = e.message;
      btn.disabled = false;
    }
  };
}

export function hideSetup() {
  $('screen-setup').hidden = true;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
