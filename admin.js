// ============================================================
//  LUMINA GALLERY — admin.js
//  Minimal admin: password gate + Gallery Settings + Albums + Save.
//  No user accounts, no CMS, no backend. See README.md → "Multi-
//  Album Admin" for the full write-up of how Save/publish works.
// ============================================================

'use strict';

const ALBUMS_URL   = 'albums.json';
const OVERRIDE_KEY = 'lumina-gallery-config-override'; // must match app.js
const UNLOCK_KEY    = 'lumina-admin-unlocked';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

function extractFolderId(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (/^YOUR_/i.test(trimmed)) return null;
  const match = trimmed.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

function slugify(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'album';
}

function uniqueId(name, existing) {
  const base = slugify(name);
  let id = base, n = 1;
  const taken = new Set(existing.map(a => a.id));
  while (taken.has(id)) id = `${base}-${++n}`;
  return id;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ────────────────────────────────────────────────────────────
//  Password gate
//
//  There's no server to keep a secret on, so this is a client-side
//  check only — it keeps casual visitors out, it isn't real access
//  control. The one password lives in config.js (CONFIG.ADMIN_PASSWORD).
// ────────────────────────────────────────────────────────────

function initPasswordGate() {
  const gate  = document.getElementById('password-gate');
  const app   = document.getElementById('admin-app');
  const form  = document.getElementById('password-form');
  const input = document.getElementById('password-input');
  const error = document.getElementById('password-error');

  const unlock = () => {
    gate.classList.add('hidden');
    app.classList.remove('hidden');
    initAdmin();
  };

  if (sessionStorage.getItem(UNLOCK_KEY) === '1') {
    unlock();
    return;
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (input.value === CONFIG.ADMIN_PASSWORD) {
      sessionStorage.setItem(UNLOCK_KEY, '1');
      unlock();
    } else {
      error.classList.remove('hidden');
      input.select();
    }
  });
}

// ────────────────────────────────────────────────────────────
//  State
// ────────────────────────────────────────────────────────────

const state = {
  settings: { title: '', subtitle: '', heroImage: '' },
  albums:   [],           // working draft, edited in-place from form inputs
  published: null,        // last-fetched albums.json (for "discard local preview")
};

const $ = id => document.getElementById(id);
let DOM = null; // resolved after unlock, once #admin-app is visible

// ────────────────────────────────────────────────────────────
//  Load
// ────────────────────────────────────────────────────────────

async function loadPublished() {
  try {
    const res = await fetch(ALBUMS_URL, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      return {
        settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
        albums:   Array.isArray(data.albums) ? data.albums : [],
      };
    }
  } catch (err) {
    console.warn('[Admin] Could not load albums.json', err);
  }
  return { settings: {}, albums: [] };
}

function loadOverride() {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (err) {
    console.warn('[Admin] Ignoring corrupt local preview', err);
  }
  return null;
}

function clone(x) { return JSON.parse(JSON.stringify(x)); }

async function initAdmin() {
  DOM = {
    sTitle: $('s-title'), sSubtitle: $('s-subtitle'), sHero: $('s-hero'),
    list: $('albums-list'), empty: $('admin-empty'),
    addBtn: $('add-album-btn'), saveBtn: $('save-btn'), saveStatus: $('save-status'),
    discardBtn: $('discard-btn'),
  };

  state.published = await loadPublished();
  const override = loadOverride();
  const base = override || clone(state.published);
  state.settings = { title: '', subtitle: '', heroImage: '', ...base.settings };
  state.albums   = base.albums || [];

  fillSettingsForm();
  renderAlbums();

  DOM.addBtn.addEventListener('click', addAlbum);
  DOM.saveBtn.addEventListener('click', onSave);
  DOM.discardBtn.addEventListener('click', onDiscard);
}

function fillSettingsForm() {
  DOM.sTitle.value    = state.settings.title    || '';
  DOM.sSubtitle.value  = state.settings.subtitle  || '';
  DOM.sHero.value      = state.settings.heroImage || '';
}

// ────────────────────────────────────────────────────────────
//  Albums list (inline rows — no modal, keeps this page light)
// ────────────────────────────────────────────────────────────

function renderAlbums() {
  const sorted = [...state.albums].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  DOM.empty.classList.toggle('hidden', sorted.length > 0);
  DOM.list.innerHTML = '';
  sorted.forEach(album => DOM.list.appendChild(renderRow(album)));
}

function renderRow(album) {
  const row = document.createElement('div');
  row.className = 'album-row';
  row.dataset.id = album.id;

  const countLabel = typeof album.imageCount === 'number'
    ? `${album.imageCount.toLocaleString()} photo${album.imageCount === 1 ? '' : 's'} as of last save`
    : 'Not yet validated — click Save to check this folder';

  row.innerHTML = `
    <div class="album-row-main">
      <input type="text" class="f-name" placeholder="Album name" value="${escHtml(album.name || '')}" />
      <input type="text" class="f-folder" placeholder="Google Drive folder URL" value="${escHtml(album.folderUrl || '')}" />
    </div>
    <div class="album-row-side">
      <label class="album-row-order">
        Order
        <input type="number" class="f-order" min="1" value="${album.order ?? 1}" />
      </label>
      <label class="field-checkbox album-row-check">
        <input type="checkbox" class="f-visible" ${album.visible !== false ? 'checked' : ''} />
        Visible
      </label>
      <label class="field-checkbox album-row-check">
        <input type="radio" name="default-album" class="f-default" ${album.default ? 'checked' : ''} />
        Default
      </label>
      <input type="text" class="f-cover" placeholder="Cover image URL (auto-detected if blank)" value="${escHtml(album.cover || '')}" />
      <button type="button" class="btn-danger f-delete" aria-label="Delete album">Delete</button>
    </div>
    ${countLabel ? `<div class="album-row-count">${countLabel}</div>` : ''}
    <div class="field-error album-row-error hidden"></div>
  `;

  const bind = (sel, prop, evt = 'input') => {
    row.querySelector(sel).addEventListener(evt, e => {
      album[prop] = e.target.type === 'checkbox' ? e.target.checked
        : e.target.type === 'number' ? Number(e.target.value)
        : e.target.value;
    });
  };
  bind('.f-name', 'name');
  bind('.f-folder', 'folderUrl');
  bind('.f-order', 'order', 'change');
  bind('.f-visible', 'visible', 'change');
  bind('.f-cover', 'cover');
  row.querySelector('.f-default').addEventListener('change', () => {
    state.albums.forEach(a => { a.default = (a.id === album.id); });
  });
  row.querySelector('.f-delete').addEventListener('click', () => {
    if (!confirm(`Delete "${album.name || 'this album'}"?`)) return;
    state.albums = state.albums.filter(a => a.id !== album.id);
    renderAlbums();
  });

  return row;
}

function addAlbum() {
  const maxOrder = state.albums.reduce((m, a) => Math.max(m, a.order ?? 0), 0);
  state.albums.push({
    id: uniqueId('album', state.albums),
    name: '', folderUrl: '', order: maxOrder + 1, visible: true,
    default: state.albums.length === 0, cover: null, imageCount: null,
  });
  renderAlbums();
  // Focus the new row's name field
  const rows = DOM.list.querySelectorAll('.f-name');
  rows[rows.length - 1]?.focus();
}

// ────────────────────────────────────────────────────────────
//  Save — validate folders, count images, detect cover, persist
//
//  imageCount and cover written here are a snapshot of what Drive
//  returned at the moment Save was clicked — not a live value. The
//  gallery (app.js) never reads these back for its own counts; it
//  always recomputes counts from a fresh Drive fetch on every page
//  load. These fields exist so this admin page has something to
//  show/export between saves, not as a cache the gallery trusts.
// ────────────────────────────────────────────────────────────

function setStatus(msg, isError) {
  DOM.saveStatus.textContent = msg;
  DOM.saveStatus.classList.remove('hidden');
  DOM.saveStatus.classList.toggle('save-status-error', !!isError);
}

async function onSave() {
  clearRowErrors();

  // 1. Basic validation
  let hasError = false;
  state.albums.forEach(album => {
    const folderId = extractFolderId(album.folderUrl);
    if (!album.name || !album.name.trim()) {
      showRowError(album.id, 'Album name is required.');
      hasError = true;
    } else if (!folderId) {
      showRowError(album.id, "Couldn't find a folder ID in that URL.");
      hasError = true;
    } else {
      album.folderId = folderId;
    }
  });
  if (hasError) {
    setStatus('Fix the highlighted albums before saving.', true);
    return;
  }

  // 2. Validate each folder against Drive: count images, detect
  //    a cover if the admin didn't set one.
  DOM.saveBtn.disabled = true;
  DOM.saveBtn.textContent = 'Validating folders…';
  setStatus(`Checking ${state.albums.length} album folder${state.albums.length === 1 ? '' : 's'}…`);

  const results = await Promise.allSettled(state.albums.map(validateAlbumFolder));
  const failed = [];
  results.forEach((r, i) => {
    const album = state.albums[i];
    if (r.status === 'fulfilled') {
      album.imageCount = r.value.count;
      if (!album.cover) album.cover = r.value.coverUrl;
    } else {
      failed.push(album.name || album.id);
      console.error(`[Admin] Could not validate "${album.name}":`, r.reason);
      showRowError(album.id, "Couldn't read this folder — check sharing settings.");
    }
  });

  // 3. Read Gallery Settings fields
  state.settings = {
    title: DOM.sTitle.value.trim(),
    subtitle: DOM.sSubtitle.value.trim(),
    heroImage: DOM.sHero.value.trim(),
  };

  // 4. Persist (live preview) + export (publish artifact)
  const payload = { settings: state.settings, albums: stripInternalFields(state.albums) };
  localStorage.setItem(OVERRIDE_KEY, JSON.stringify(payload));
  downloadConfig(payload);

  renderAlbums();
  DOM.saveBtn.disabled = false;
  DOM.saveBtn.textContent = 'Save';

  if (failed.length) {
    setStatus(`Saved with issues — couldn't read: ${failed.join(', ')}. Other albums saved fine.`, true);
  } else {
    const totalPhotos = state.albums.reduce((sum, a) => sum + (a.imageCount || 0), 0);
    setStatus(`✓ Saved — ${state.albums.length} albums, ${totalPhotos.toLocaleString()} photos. Previewing on this device; albums.json downloaded for publishing.`);
  }
}

function stripInternalFields(albums) {
  return albums.map(({ id, name, folderUrl, order, visible, default: isDefault, cover, imageCount }) =>
    ({ id, name, folderUrl, order, visible, default: !!isDefault, cover: cover || null, imageCount: imageCount ?? null }));
}

function showRowError(albumId, msg) {
  const row = DOM.list.querySelector(`.album-row[data-id="${CSS.escape(albumId)}"]`);
  const el = row?.querySelector('.album-row-error');
  if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

function clearRowErrors() {
  DOM.list.querySelectorAll('.album-row-error').forEach(el => {
    el.textContent = ''; el.classList.add('hidden');
  });
}

// Counts images and finds a cover candidate for one Drive folder.
// Loops pagination fully (same pattern as app.js) since this only
// runs on an explicit Save click, not on every page load.
async function validateAlbumFolder(album) {
  const mimeQuery = ['image/jpeg','image/png','image/gif','image/webp','image/heic','image/tiff','image/svg+xml']
    .map(t => `mimeType='${t}'`).join(' or ');
  const query  = encodeURIComponent(`'${album.folderId}' in parents and (${mimeQuery}) and trashed=false`);
  const fields = encodeURIComponent('nextPageToken,files(id,createdTime)');

  let pageToken, count = 0, firstId = null;
  do {
    let url = `${DRIVE_API}/files?q=${query}&key=${CONFIG.API_KEY}&pageSize=1000&fields=${fields}&orderBy=createdTime%20desc`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error?.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    const files = data.files || [];
    if (!firstId && files.length) firstId = files[0].id;
    count += files.length;
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return {
    count,
    coverUrl: firstId ? `https://drive.google.com/thumbnail?id=${firstId}&sz=w600` : null,
  };
}

function downloadConfig(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'albums.json';
  a.click();
  URL.revokeObjectURL(url);
}

function onDiscard() {
  if (!confirm('Discard this device\'s preview changes and reload the currently-published albums.json?')) return;
  localStorage.removeItem(OVERRIDE_KEY);
  state.settings = { title: '', subtitle: '', heroImage: '', ...state.published.settings };
  state.albums   = clone(state.published.albums || []);
  fillSettingsForm();
  renderAlbums();
  setStatus('Reverted to published albums.json');
}

document.addEventListener('DOMContentLoaded', initPasswordGate);
