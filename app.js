// ============================================================
//  LUMINA GALLERY — app.js  (v4 — full production rewrite)
//  Pure vanilla JS · No build step · No framework
//  Requires: config.js loaded before this file
//
//  CHANGES IN v4
//  ─────────────
//  HEIC     Fix browserSupportsHeic() (canvas probe was broken on
//            all browsers). Fetch raw bytes via Drive alt=media.
//            Cache blob URLs. Deduplicate concurrent conversions.
//            Graceful fallback UI when conversion fails.
//
//  Lightbox Three-phase progressive load:
//            1) Blur-up thumbnail preview shown instantly.
//            2) Blob cache hit → instant full-res (no spinner).
//            3) fetch-to-blob with cascading size fallbacks
//               [2000, 1600, 1200, 1024, 800].
//            Render-token pattern prevents stale callbacks.
//            Prefetch ±3 neighbours into blob cache.
//            Pinch-to-zoom + double-tap zoom on touch.
//
//  Grid     appendGrid() is append-only. Never wipes DOM.
//            One IntersectionObserver per card, disconnected on
//            trigger (no memory leak). requestIdleCallback for
//            non-urgent card setup.
//
//  Network  fetchWithRetry() with exponential backoff (3 attempts).
//            Concurrent request throttle (MAX_CONCURRENT = 6).
//            Responsive image sizes per viewport width.
//
//  Memory   LRU-capped blob cache (MAX_CACHE = 60 entries).
//            Revoke oldest blob URLs when cap is exceeded.
// ============================================================

'use strict';

// ────────────────────────────────────────────────────────────
//  Constants
// ────────────────────────────────────────────────────────────

const DRIVE_API      = 'https://www.googleapis.com/drive/v3';
const MAX_CACHE      = 60;   // max full-res blob URLs to keep in memory
const MAX_CONCURRENT = 6;    // max parallel Drive fetch requests
const LB_SIZES       = [2000, 1600, 1200, 1024, 800]; // lightbox fallback chain

// ────────────────────────────────────────────────────────────
//  Responsive image size helpers
// ────────────────────────────────────────────────────────────

function getViewportSize() {
  const w = window.innerWidth;
  if (w <= 480)  return 'mobile';
  if (w <= 768)  return 'tablet';
  if (w <= 1440) return 'desktop';
  return 'wide';
}

function getThumbnailSize() {
  const vp = getViewportSize();
  return vp === 'mobile' ? 300 : vp === 'tablet' ? 400 : 400;
}

function getLightboxSize() {
  const vp = getViewportSize();
  if (vp === 'mobile')  return 800;
  if (vp === 'tablet')  return 1200;
  if (vp === 'desktop') return 1600;
  return 2000;
}

// ────────────────────────────────────────────────────────────
//  URL builders  (thumbnail API only — no uc?export=view)
// ────────────────────────────────────────────────────────────

function getThumbnailUrl(fileId, size) {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size || getThumbnailSize()}`;
}

function getFullImageUrl(fileId, size) {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size || getLightboxSize()}`;
}

// Raw file download via Drive API (needed for HEIC — thumbnail
// endpoint silently re-encodes HEIC → JPEG, breaking heic2any)
function getRawFileUrl(fileId) {
  return `${DRIVE_API}/files/${fileId}?alt=media&key=${CONFIG.API_KEY}`;
}

// ────────────────────────────────────────────────────────────
//  Concurrent-request throttle
// ────────────────────────────────────────────────────────────

let _activeRequests = 0;
const _requestQueue = [];

function throttledFetch(url, options) {
  return new Promise((resolve, reject) => {
    const run = () => {
      _activeRequests++;
      fetch(url, options)
        .then(resolve, reject)
        .finally(() => {
          _activeRequests--;
          if (_requestQueue.length) _requestQueue.shift()();
        });
    };
    if (_activeRequests < MAX_CONCURRENT) {
      run();
    } else {
      _requestQueue.push(run);
    }
  });
}

// ────────────────────────────────────────────────────────────
//  Retry-with-backoff fetch
// ────────────────────────────────────────────────────────────

async function fetchWithRetry(url, retries = 3, delayMs = 400) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await throttledFetch(url);
      if (res.ok) return res;
      // 4xx (except 429) are client errors — don't retry
      if (res.status < 500 && res.status !== 429) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || `HTTP ${res.status}`);
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, delayMs * (2 ** attempt)));
    }
  }
  throw lastErr;
}

// ────────────────────────────────────────────────────────────
//  Drive API
// ────────────────────────────────────────────────────────────

async function fetchDriveImages({ folderId, apiKey, pageToken, pageSize, orderBy }) {
  const mimeQuery = CONFIG.SUPPORTED_TYPES.map(t => `mimeType='${t}'`).join(' or ');
  const query  = encodeURIComponent(`'${folderId}' in parents and (${mimeQuery}) and trashed=false`);
  const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,imageMediaMetadata)');

  let url = `${DRIVE_API}/files?q=${query}&key=${apiKey}&pageSize=${pageSize}&fields=${fields}&orderBy=${encodeURIComponent(orderBy)}`;
  if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

  const res  = await fetchWithRetry(url);
  const data = await res.json();

  const thumbSz = getThumbnailSize();
  const files = (data.files || []).map(f => ({
    ...f,
    thumbnailUrl: getThumbnailUrl(f.id, thumbSz),
    fullUrl:      getFullImageUrl(f.id),
    downloadUrl:  getFullImageUrl(f.id, 2000),
    isDemo: false,
    isHeic: isHeicFile(f.name, f.mimeType),
  }));

  return { files, nextPageToken: data.nextPageToken || null };
}

// ────────────────────────────────────────────────────────────
//  Demo images (Picsum — shown when credentials are placeholders)
// ────────────────────────────────────────────────────────────

function buildDemoImages() {
  const topics = ['nature','architecture','travel','city','abstract','food','portrait','ocean','mountain','forest'];
  return Array.from({ length: 30 }, (_, i) => {
    const seed = i + 1;
    const topic = topics[i % topics.length];
    const w = 800 + (i % 3) * 400;
    const h = 600 + (i % 4) * 150;
    return {
      id: `demo-${seed}`,
      name: `${topic}-photo-${seed}.jpg`,
      mimeType: 'image/jpeg',
      createdTime:  new Date(Date.now() - seed * 86400000).toISOString(),
      modifiedTime: new Date(Date.now() - seed * 43200000).toISOString(),
      thumbnailUrl: `https://picsum.photos/seed/${seed}/400/300`,
      fullUrl:      `https://picsum.photos/seed/${seed}/${w}/${h}`,
      downloadUrl:  `https://picsum.photos/seed/${seed}/${w}/${h}`,
      size: null, isDemo: true, isHeic: false,
    };
  });
}

// ────────────────────────────────────────────────────────────
//  HEIC detection & conversion
// ────────────────────────────────────────────────────────────
//
//  ROOT CAUSE of previous failures (documented for future readers):
//
//  1. browserSupportsHeic() used canvas.toDataURL('image/heic').
//     All browsers (including Safari) return 'data:image/png' when
//     the requested format is unsupported, so the probe always
//     returned false and conversion was attempted on every browser.
//
//  2. resolveHeicUrls() fetched image.fullUrl which is the Drive
//     *thumbnail* endpoint.  Google silently re-encodes HEIC to
//     JPEG before serving it from that endpoint.  heic2any received
//     JPEG bytes and threw ERR_FORMAT_NOT_SUPPORTED, which was
//     silently caught, then the code fell back to the same URL that
//     also fails — causing an infinite spinner.
//
//  FIXES:
//  • Detect HEIC support via UA string (Safari ≥ 17).
//  • Fetch raw bytes via Drive files?alt=media endpoint.
//  • Verify response is not HTML (Drive permission page).
//  • Log every step so failures appear in DevTools console.
//  • Single conversion per file; concurrent callers share one Promise.
//  • LRU-bounded cache prevents unbounded memory growth.

function isHeicFile(name = '', mimeType = '') {
  return /\.heic$/i.test(name) || /\.heif$/i.test(name) ||
         mimeType === 'image/heic' || mimeType === 'image/heif';
}

// Cached result so we only compute once
let _heicSupportedResult = null;

function browserSupportsHeic() {
  if (_heicSupportedResult !== null) return _heicSupportedResult;
  // Safari 17+ (iOS 17+ / macOS Sonoma+) renders HEIC natively.
  // All Chromium-based browsers and Firefox need conversion.
  const ua = navigator.userAgent;
  const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|EdgA|OPR/i.test(ua);
  if (!isSafari) { _heicSupportedResult = false; return false; }
  const vMatch = ua.match(/Version\/(\d+)/);
  _heicSupportedResult = vMatch ? parseInt(vMatch[1], 10) >= 17 : false;
  console.log(`[HEIC] Native support: ${_heicSupportedResult} (UA=${ua.substring(0, 80)})`);
  return _heicSupportedResult;
}

// fileId → { thumbnailBlobUrl, fullBlobUrl }
const heicBlobCache = new Map();
// fileId → Promise<{thumbnailBlobUrl,fullBlobUrl}>  (deduplication)
const heicInFlight  = new Map();

async function resolveHeicUrls(image) {
  // Non-HEIC or natively supported: pass through unchanged
  if (!image.isHeic || browserSupportsHeic()) {
    return { thumbnailBlobUrl: image.thumbnailUrl, fullBlobUrl: image.fullUrl };
  }

  if (heicBlobCache.has(image.id)) {
    console.log(`[HEIC] Cache hit: ${image.name}`);
    return heicBlobCache.get(image.id);
  }

  if (heicInFlight.has(image.id)) {
    console.log(`[HEIC] Awaiting in-flight conversion: ${image.name}`);
    return heicInFlight.get(image.id);
  }

  const promise = (async () => {
    if (typeof heic2any === 'undefined') {
      console.error('[HEIC] heic2any library missing — check <script> tag in index.html');
      return { thumbnailBlobUrl: null, fullBlobUrl: null };
    }

    console.log(`[HEIC] Converting: ${image.name}`);

    // Fetch raw HEIC bytes.  Demo images use their fullUrl directly.
    const rawUrl = image.isDemo ? image.fullUrl : getRawFileUrl(image.id);
    let rawBlob;
    try {
      const res = await fetchWithRetry(rawUrl);
      rawBlob   = await res.blob();
      console.log(`[HEIC] Raw blob: ${rawBlob.size} bytes, type: ${rawBlob.type}`);
    } catch (err) {
      console.error(`[HEIC] Failed to fetch raw bytes for ${image.name}:`, err);
      return { thumbnailBlobUrl: null, fullBlobUrl: null };
    }

    // Guard: Drive sometimes returns an HTML permission page
    if (rawBlob.type.startsWith('text/html') || rawBlob.size < 200) {
      console.error(`[HEIC] Non-HEIC response received (type=${rawBlob.type}, size=${rawBlob.size}). ` +
        'Make sure the folder is set to "Anyone with the link can view".');
      return { thumbnailBlobUrl: null, fullBlobUrl: null };
    }

    try {
      const converted = await heic2any({ blob: rawBlob, toType: 'image/jpeg', quality: 0.90 });
      const jpegBlob  = Array.isArray(converted) ? converted[0] : converted;
      console.log(`[HEIC] Conversion OK: ${jpegBlob.size} bytes`);
      const blobUrl   = URL.createObjectURL(jpegBlob);
      const result    = { thumbnailBlobUrl: blobUrl, fullBlobUrl: blobUrl };
      heicBlobCache.set(image.id, result);
      return result;
    } catch (err) {
      console.error(`[HEIC] heic2any failed for ${image.name}:`, err);
      return { thumbnailBlobUrl: null, fullBlobUrl: null };
    }
  })();

  heicInFlight.set(image.id, promise);
  const result = await promise;
  heicInFlight.delete(image.id);
  return result;
}

// ────────────────────────────────────────────────────────────
//  Full-resolution blob cache  (LRU, capped at MAX_CACHE)
// ────────────────────────────────────────────────────────────

// Insertion-order LRU: delete + re-insert on access
const imageCache = new Map(); // fileId → blobUrl
const imageCachePending = new Map(); // fileId → Promise<blobUrl>

function cachePut(fileId, blobUrl) {
  if (imageCache.has(fileId)) imageCache.delete(fileId); // refresh order
  imageCache.set(fileId, blobUrl);
  // Evict oldest entries when over cap
  if (imageCache.size > MAX_CACHE) {
    const oldest = imageCache.keys().next().value;
    const oldUrl = imageCache.get(oldest);
    imageCache.delete(oldest);
    // Revoke only blob: URLs (not Drive thumbnail URLs which are reusable)
    if (oldUrl && oldUrl.startsWith('blob:')) URL.revokeObjectURL(oldUrl);
  }
}

function cacheGet(fileId) {
  if (!imageCache.has(fileId)) return null;
  const url = imageCache.get(fileId);
  imageCache.delete(fileId);
  imageCache.set(fileId, url); // move to end (most recently used)
  return url;
}

// NOTE: Drive thumbnail URLs do NOT support CORS fetch() — the endpoint
// omits Access-Control-Allow-Origin headers, causing 403/CORS failures
// when called from JS fetch().  Browsers bypass CORS for <img> src
// assignments, so we load images via img.src instead of fetch()→blob().
// fetchImageToCache is only used for HEIC blob URLs (already a blob:)
// and for neighbour prefetch (which also must use img.src, see below).
async function fetchImageToCache(fileId, size) {
  const cached = cacheGet(fileId);
  if (cached) return cached;
  // For non-HEIC Drive images we cache the Drive thumbnail URL directly
  // (not a blob URL) — the browser's HTTP cache handles deduplication.
  const url = getFullImageUrl(fileId, size || getLightboxSize());
  cachePut(fileId, url);
  return url;
}

// Prefetch ±3 neighbours via hidden <img> elements (NOT fetch — CORS)
function prefetchAdjacentImages(imgs, currentIndex) {
  [-3, -2, -1, 1, 2, 3].forEach(offset => {
    const img = imgs[currentIndex + offset];
    if (!img || img.isHeic) return;
    if (cacheGet(img.id)) return;
    // Warm the browser's HTTP cache with a detached img element
    const el = new window.Image();
    el.src = getFullImageUrl(img.id, getLightboxSize());
    // Also record in our LRU cache so Phase 2 can detect the hit
    cachePut(img.id, el.src);
  });
}

// ────────────────────────────────────────────────────────────
//  Application state
// ────────────────────────────────────────────────────────────

const state = {
  allImages:      [],
  renderedCount:  0,
  loading:        false,
  initialLoading: true,
  error:          null,
  hasMore:        true,
  pageToken:      null,
  isFetching:     false,
  searchQuery:    '',
  sortBy:         CONFIG.DEFAULT_SORT     || 'createdTime',
  sortDir:        CONFIG.DEFAULT_SORT_DIR || 'desc',
  isDemoMode:     false,

  // Lightbox
  lightboxIndex: null,
  lbZoom:        1,
  lbPan:         { x: 0, y: 0 },
  lbDragging:    false,
  lbDragStart:   null,
  // Touch tracking (swipe + pinch)
  lbTouchStart:  null,
  lbPinchDist:   null,
  lbPinchZoom:   null,
  lbLastTap:     0,   // for double-tap detection
  // Render token prevents stale async callbacks from updating UI
  lbRenderToken: 0,
};

function isDemoCredentials() {
  return (
    !CONFIG.FOLDER_ID || CONFIG.FOLDER_ID === 'YOUR_GOOGLE_DRIVE_FOLDER_ID' ||
    !CONFIG.API_KEY   || CONFIG.API_KEY   === 'YOUR_GOOGLE_API_KEY'
  );
}

// ────────────────────────────────────────────────────────────
//  DOM refs  (resolved once at boot — not on every access)
// ────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const DOM = {
  galleryTitle:    $('gallery-title'),
  gallerySubtitle: $('gallery-subtitle'),
  searchInput:     $('search-input'),
  searchClear:     $('search-clear'),
  sortDate:        $('sort-date'),
  sortName:        $('sort-name'),
  countText:       $('count-text'),
  demoBadge:       $('demo-badge'),
  darkToggle:      $('dark-toggle'),
  iconMoon:        $('icon-moon'),
  iconSun:         $('icon-sun'),
  demoBanner:      $('demo-banner'),
  errorBanner:     $('error-banner'),
  errorMessage:    $('error-message'),
  retryBtn:        $('retry-btn'),
  skeletonGrid:    $('skeleton-grid'),
  emptyState:      $('empty-state'),
  emptyTitle:      $('empty-title'),
  emptyBody:       $('empty-body'),
  clearSearchBtn:  $('clear-search-btn'),
  galleryGrid:     $('gallery-grid'),
  loadSpinner:     $('load-spinner'),
  endNotice:       $('end-notice'),
  sentinel:        $('sentinel'),
  // Lightbox
  lightbox:    $('lightbox'),
  lbTitle:     $('lb-title'),
  lbMeta:      $('lb-meta'),
  lbClose:     $('lb-close'),
  lbPrev:      $('lb-prev'),
  lbNext:      $('lb-next'),
  lbStage:     $('lb-stage'),
  lbImgWrap:   $('lb-img-wrap'),
  lbPreview:   $('lb-preview'),
  lbImg:       $('lb-img'),
  lbSpinner:   $('lb-spinner'),
  lbError:     $('lb-error'),
  lbZoomIn:    $('lb-zoom-in'),
  lbZoomOut:   $('lb-zoom-out'),
  lbZoomReset: $('lb-zoom-reset'),
  lbDownload:  $('lb-download'),
  filmstrip:   $('filmstrip'),
};

// ────────────────────────────────────────────────────────────
//  Init
// ────────────────────────────────────────────────────────────

function init() {
  document.title                  = CONFIG.GALLERY_TITLE;
  DOM.galleryTitle.textContent    = CONFIG.GALLERY_TITLE;
  DOM.gallerySubtitle.textContent = CONFIG.GALLERY_SUBTITLE;

  // Dark mode
  const savedDark = localStorage.getItem('lumina-dark-mode');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyDarkMode(savedDark !== null ? JSON.parse(savedDark) : prefersDark);
  DOM.darkToggle.addEventListener('click', () => {
    const isDark = document.body.classList.contains('dark');
    applyDarkMode(!isDark);
    localStorage.setItem('lumina-dark-mode', JSON.stringify(!isDark));
  });

  // Search (debounced 200 ms)
  let searchTimer;
  DOM.searchInput.addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchQuery = e.target.value;
      DOM.searchClear.classList.toggle('hidden', !state.searchQuery);
      state.renderedCount = 0;
      DOM.galleryGrid.innerHTML = '';
      renderGallery();
    }, 200);
  });
  DOM.searchClear.addEventListener('click', clearSearch);
  DOM.clearSearchBtn.addEventListener('click', clearSearch);

  // Sort
  DOM.sortDate.addEventListener('click', () => cycleSort('createdTime'));
  DOM.sortName.addEventListener('click', () => cycleSort('name'));

  // Retry
  DOM.retryBtn.addEventListener('click', () => {
    state.allImages = []; state.renderedCount = 0;
    state.hasMore = true; state.pageToken = null;
    DOM.galleryGrid.innerHTML = '';
    fetchPage(true);
  });

  // Infinite scroll sentinel — created once, never destroyed
  const sentinelObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && state.hasMore && !state.isFetching && !state.initialLoading) {
      fetchPage(false);
    }
  }, { rootMargin: '600px', threshold: 0 });
  sentinelObserver.observe(DOM.sentinel);

  // Lightbox controls
  DOM.lbClose.addEventListener('click', closeLightbox);
  DOM.lbPrev.addEventListener('click',  () => navigateLightbox(state.lightboxIndex - 1));
  DOM.lbNext.addEventListener('click',  () => navigateLightbox(state.lightboxIndex + 1));
  DOM.lbZoomIn.addEventListener('click',    lbZoomIn);
  DOM.lbZoomOut.addEventListener('click',   lbZoomOut);
  DOM.lbZoomReset.addEventListener('click', lbResetZoom);
  DOM.lbDownload.addEventListener('click',  lbDownload);

  // Close on backdrop
  DOM.lbStage.addEventListener('click', e => {
    if (e.target === DOM.lbStage) closeLightbox();
  });

  // Wheel zoom
  DOM.lbStage.addEventListener('wheel', e => {
    e.preventDefault();
    e.deltaY < 0 ? lbZoomIn() : lbZoomOut();
  }, { passive: false });

  // Mouse drag (pan when zoomed)
  DOM.lbStage.addEventListener('mousedown', e => {
    if (e.button !== 0 || state.lbZoom <= 1) return;
    state.lbDragging  = true;
    state.lbDragStart = { x: e.clientX - state.lbPan.x, y: e.clientY - state.lbPan.y };
    DOM.lbStage.style.cursor = 'grabbing';
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!state.lbDragging || !state.lbDragStart) return;
    state.lbPan = { x: e.clientX - state.lbDragStart.x, y: e.clientY - state.lbDragStart.y };
    applyLbTransform();
  });
  window.addEventListener('mouseup', () => {
    if (!state.lbDragging) return;
    state.lbDragging = false;
    DOM.lbStage.style.cursor = state.lbZoom > 1 ? 'grab' : 'default';
  });

  // Touch: swipe, pinch-zoom, double-tap
  DOM.lbStage.addEventListener('touchstart', onLbTouchStart, { passive: true });
  DOM.lbStage.addEventListener('touchmove',  onLbTouchMove,  { passive: false });
  DOM.lbStage.addEventListener('touchend',   onLbTouchEnd,   { passive: true });

  window.addEventListener('keydown', onKeyDown);

  buildSkeleton();
  fetchPage(true);
}

// ────────────────────────────────────────────────────────────
//  Touch handlers (swipe + pinch + double-tap)
// ────────────────────────────────────────────────────────────

function getTouchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function onLbTouchStart(e) {
  if (e.touches.length === 1) {
    state.lbTouchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() };
    state.lbPinchDist  = null;
    state.lbPinchZoom  = null;
  } else if (e.touches.length === 2) {
    state.lbPinchDist = getTouchDist(e.touches);
    state.lbPinchZoom = state.lbZoom;
    state.lbTouchStart = null;
  }
}

function onLbTouchMove(e) {
  if (e.touches.length === 2 && state.lbPinchDist !== null) {
    e.preventDefault();
    const newDist = getTouchDist(e.touches);
    const scale   = (newDist / state.lbPinchDist) * state.lbPinchZoom;
    state.lbZoom  = Math.min(Math.max(scale, 1), 5);
    if (state.lbZoom <= 1) state.lbPan = { x: 0, y: 0 };
    applyLbTransform();
    updateZoomUI();
  }
}

function onLbTouchEnd(e) {
  // Pinch end
  if (e.touches.length < 2) {
    state.lbPinchDist = null;
    state.lbPinchZoom = null;
    if (state.lbZoom < 1.1) {
      state.lbZoom = 1;
      state.lbPan  = { x: 0, y: 0 };
      applyLbTransform();
      updateZoomUI();
    }
    return;
  }

  if (!state.lbTouchStart) return;

  const now = Date.now();
  const dx  = e.changedTouches[0].clientX - state.lbTouchStart.x;
  const dy  = e.changedTouches[0].clientY - state.lbTouchStart.y;
  const dt  = now - state.lbTouchStart.time;

  // Double-tap to zoom
  if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 250) {
    if (now - state.lbLastTap < 350) {
      state.lbLastTap = 0;
      if (state.lbZoom > 1) {
        state.lbZoom = 1; state.lbPan = { x: 0, y: 0 };
      } else {
        state.lbZoom = 2.5;
      }
      applyLbTransform(); updateZoomUI();
      return;
    }
    state.lbLastTap = now;
  }

  // Swipe navigation
  if (Math.abs(dx) > 50 && dt < 350 && Math.abs(dx) > Math.abs(dy) && state.lbZoom <= 1) {
    dx < 0
      ? navigateLightbox(state.lightboxIndex + 1)
      : navigateLightbox(state.lightboxIndex - 1);
  }

  state.lbTouchStart = null;
}

// ────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────

function clearSearch() {
  state.searchQuery = '';
  DOM.searchInput.value = '';
  DOM.searchClear.classList.add('hidden');
  state.renderedCount = 0;
  DOM.galleryGrid.innerHTML = '';
  renderGallery();
}

function applyDarkMode(dark) {
  document.body.classList.toggle('dark',  dark);
  document.body.classList.toggle('light', !dark);
  DOM.iconMoon.classList.toggle('hidden',  dark);
  DOM.iconSun.classList.toggle('hidden',  !dark);
}

// ────────────────────────────────────────────────────────────
//  Sort
// ────────────────────────────────────────────────────────────

function cycleSort(field) {
  if (state.sortBy === field) {
    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortBy  = field;
    state.sortDir = 'desc';
  }
  updateSortUI();

  if (!state.isDemoMode) {
    state.allImages = []; state.renderedCount = 0;
    state.hasMore = true; state.pageToken = null;
    DOM.galleryGrid.innerHTML = '';
    fetchPage(true);
  } else {
    state.renderedCount = 0;
    DOM.galleryGrid.innerHTML = '';
    renderGallery();
  }
}

function updateSortUI() {
  const dateActive = state.sortBy === 'createdTime';
  DOM.sortDate.classList.toggle('active', dateActive);
  DOM.sortName.classList.toggle('active', !dateActive);
  const da = DOM.sortDate.querySelector('.sort-arrow');
  const na = DOM.sortName.querySelector('.sort-arrow');
  if (dateActive) {
    da.textContent = state.sortDir === 'asc' ? '↑' : '↓';
    da.classList.remove('sort-arrow-hidden');
    na.classList.add('sort-arrow-hidden');
  } else {
    na.textContent = state.sortDir === 'asc' ? '↑' : '↓';
    na.classList.remove('sort-arrow-hidden');
    da.classList.add('sort-arrow-hidden');
  }
}

// ────────────────────────────────────────────────────────────
//  Fetch
// ────────────────────────────────────────────────────────────

async function fetchPage(reset = false) {
  if (state.isFetching) return;
  if (!reset && !state.hasMore) return;

  // Demo mode
  if (isDemoCredentials()) {
    state.isDemoMode    = true;
    state.allImages     = buildDemoImages();
    state.hasMore       = false;
    state.initialLoading = false;
    DOM.demoBanner.classList.remove('hidden');
    DOM.demoBadge.classList.remove('hidden');
    renderGallery();
    return;
  }

  state.isFetching = true;
  state.error      = null;

  if (reset) {
    state.initialLoading = true;
    state.pageToken = null;
    DOM.skeletonGrid.classList.remove('hidden');
    DOM.galleryGrid.classList.add('hidden');
    DOM.errorBanner.classList.add('hidden');
  } else {
    state.loading = true;
    DOM.loadSpinner.classList.remove('hidden');
  }

  try {
    const { files, nextPageToken } = await fetchDriveImages({
      folderId:  CONFIG.FOLDER_ID,
      apiKey:    CONFIG.API_KEY,
      pageToken: reset ? undefined : state.pageToken,
      pageSize:  CONFIG.PAGE_SIZE,
      orderBy:   `${state.sortBy} ${state.sortDir}`,
    });
    state.pageToken = nextPageToken;
    state.allImages = reset ? files : [...state.allImages, ...files];
    state.hasMore   = !!nextPageToken;
  } catch (err) {
    console.error('[Lumina] Fetch error:', err);
    state.error = err.message || 'Failed to load images. Check your API key and folder ID.';
    if (reset) state.hasMore = false;
  } finally {
    state.loading        = false;
    state.initialLoading = false;
    state.isFetching     = false;
    DOM.loadSpinner.classList.add('hidden');
    DOM.skeletonGrid.classList.add('hidden');
    renderGallery();
  }
}

// ────────────────────────────────────────────────────────────
//  Render
// ────────────────────────────────────────────────────────────

function getFilteredImages() {
  let imgs = state.allImages;
  if (state.searchQuery.trim()) {
    const q = state.searchQuery.toLowerCase();
    imgs = imgs.filter(img => img.name.toLowerCase().includes(q));
  }
  if (state.isDemoMode) {
    const key = state.sortBy === 'name' ? 'name' : state.sortBy;
    imgs = [...imgs].sort((a, b) => {
      const cmp = String(a[key] || '').localeCompare(String(b[key] || ''), undefined, { numeric: true });
      return state.sortDir === 'asc' ? cmp : -cmp;
    });
  }
  return imgs;
}

function renderGallery() {
  const imgs = getFilteredImages();
  DOM.countText.textContent = `${state.allImages.length.toLocaleString()} photo${state.allImages.length !== 1 ? 's' : ''}`;

  if (state.error) {
    DOM.errorBanner.classList.remove('hidden');
    DOM.errorMessage.textContent = state.error;
  } else {
    DOM.errorBanner.classList.add('hidden');
  }

  const isEmpty = !state.initialLoading && !state.error && imgs.length === 0;
  DOM.emptyState.classList.toggle('hidden', !isEmpty);
  if (isEmpty) {
    DOM.emptyTitle.textContent = state.searchQuery ? 'No photos match your search' : 'No photos found';
    DOM.emptyBody.textContent  = state.searchQuery
      ? 'Try a different search term.'
      : 'Make sure your Google Drive folder contains images and is accessible.';
    DOM.clearSearchBtn.classList.toggle('hidden', !state.searchQuery);
  }

  if (!state.initialLoading && imgs.length > 0) {
    DOM.galleryGrid.classList.remove('hidden');
    appendGrid(imgs);
  } else if (!state.initialLoading) {
    DOM.galleryGrid.classList.add('hidden');
  }

  if (!state.hasMore && imgs.length > 0 && !state.loading) {
    DOM.endNotice.textContent = `✓ All ${imgs.length.toLocaleString()} photos loaded`;
    DOM.endNotice.classList.remove('hidden');
  } else {
    DOM.endNotice.classList.add('hidden');
  }
}

// ────────────────────────────────────────────────────────────
//  Grid — append-only (never wipes DOM between pages)
// ────────────────────────────────────────────────────────────

function appendGrid(images) {
  const fragment = document.createDocumentFragment();

  for (let i = state.renderedCount; i < images.length; i++) {
    const image = images[i];
    const index = i; // capture for closures

    const item = document.createElement('div');
    item.className = 'grid-item';

    const card = document.createElement('div');
    card.className = 'img-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Open ${formatName(image.name)}`);
    card.style.transitionDelay = `${Math.min(index % 12, 11) * 35}ms`;

    const skel = document.createElement('div');
    skel.className = 'card-skeleton';
    card.appendChild(skel);

    // Lazy-load: one observer per card, disconnected on first trigger
    const obs = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      obs.disconnect();
      // Use requestIdleCallback when available to avoid jank
      const schedule = window.requestIdleCallback || (cb => setTimeout(cb, 1));
      schedule(() => loadCardImage(card, skel, image, index));
    }, { rootMargin: '400px' });
    obs.observe(card);

    card.addEventListener('click',   () => openLightbox(index));
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(index); } });

    item.appendChild(card);
    fragment.appendChild(item);
  }

  DOM.galleryGrid.appendChild(fragment);
  state.renderedCount = images.length;
}

// ────────────────────────────────────────────────────────────
//  Card image loader
// ────────────────────────────────────────────────────────────

function loadCardImage(card, skel, image) {
  const img = document.createElement('img');
  img.className = 'card-img';
  img.alt       = formatName(image.name);
  img.decoding  = 'async';

  const overlay = document.createElement('div');
  overlay.className = 'card-overlay';
  overlay.innerHTML = `<p class="card-name">${escHtml(formatName(image.name))}</p>`;

  if (image.isHeic) {
    const badge = document.createElement('span');
    badge.className = 'heic-badge';
    badge.textContent = 'HEIC';
    card.appendChild(badge);
  }

  img.addEventListener('load', () => {
    skel.remove();
    card.classList.add('loaded');
  });

  img.addEventListener('error', () => {
    skel.remove();
    const errDiv = document.createElement('div');
    errDiv.className = 'card-error';
    errDiv.innerHTML = `
      <svg width="28" height="28" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
      </svg>
      <span>${image.isHeic ? 'HEIC conversion failed' : 'Unavailable'}</span>`;
    card.appendChild(errDiv);
    card.classList.add('loaded');
  });

  card.appendChild(img);
  card.appendChild(overlay);

  if (image.isHeic && !browserSupportsHeic()) {
    resolveHeicUrls(image).then(({ thumbnailBlobUrl }) => {
      if (thumbnailBlobUrl) {
        img.src = thumbnailBlobUrl;
      } else {
        img.dispatchEvent(new Event('error'));
      }
    });
  } else {
    img.src = image.thumbnailUrl;
  }
}

// ────────────────────────────────────────────────────────────
//  Skeleton loader
// ────────────────────────────────────────────────────────────

function buildSkeleton() {
  const heights = ['75%', '56.25%', '100%', '66.66%', '140%', '60%', '80%', '50%'];
  for (let i = 0; i < 16; i++) {
    const item = document.createElement('div');
    item.className = 'skeleton-item';
    item.style.paddingBottom  = heights[i % heights.length];
    item.style.animationDelay = `${(i % 8) * 80}ms`;
    DOM.skeletonGrid.appendChild(item);
  }
  DOM.skeletonGrid.classList.remove('hidden');
}

// ────────────────────────────────────────────────────────────
//  Lightbox — open / close / navigate
// ────────────────────────────────────────────────────────────

function openLightbox(index) {
  const imgs = getFilteredImages();
  if (index < 0 || index >= imgs.length) return;
  state.lightboxIndex = index;
  state.lbZoom = 1;
  state.lbPan  = { x: 0, y: 0 };
  DOM.lightbox.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  renderLightbox();
}

function closeLightbox() {
  state.lbRenderToken++;
  DOM.lbImg.onload  = null;
  DOM.lbImg.onerror = null;
  DOM.lbImg.src     = '';
  if (DOM.lbPreview) DOM.lbPreview.src = '';
  state.lightboxIndex = null;
  DOM.lightbox.classList.add('hidden');
  document.body.style.overflow = '';
}

function navigateLightbox(index) {
  const imgs = getFilteredImages();
  if (index < 0 || index >= imgs.length) return;
  state.lightboxIndex = index;
  state.lbZoom = 1;
  state.lbPan  = { x: 0, y: 0 };
  renderLightbox();
}

// ────────────────────────────────────────────────────────────
//  Lightbox — render  (3-phase progressive loading)
//
//  Phase 1: Blur-up thumbnail (instant, always visible)
//  Phase 2: Blob cache hit    (instant full-res, no spinner)
//  Phase 3: fetch-to-blob with cascading size fallbacks
// ────────────────────────────────────────────────────────────

async function renderLightbox() {
  const token = ++state.lbRenderToken;
  const imgs  = getFilteredImages();
  const index = state.lightboxIndex;
  const image = imgs[index];
  if (!image) return;

  // Header
  DOM.lbTitle.textContent = formatName(image.name);
  const dateStr = image.createdTime ? ` · ${formatDate(image.createdTime)}` : '';
  DOM.lbMeta.textContent = `${index + 1} / ${imgs.length}${dateStr}`;

  // Nav buttons
  DOM.lbPrev.disabled = index === 0;
  DOM.lbNext.disabled = index === imgs.length - 1;

  // Reset image elements
  DOM.lbImg.onload  = null;
  DOM.lbImg.onerror = null;
  DOM.lbImg.classList.add('hidden');
  DOM.lbImg.style.opacity = '0';
  DOM.lbImg.src = '';
  DOM.lbError.classList.add('hidden');
  DOM.lbSpinner.classList.remove('hidden');

  // Phase 1: blur-up preview
  const previewUrl = heicBlobCache.has(image.id)
    ? heicBlobCache.get(image.id).thumbnailBlobUrl
    : image.thumbnailUrl;
  if (DOM.lbPreview) {
    DOM.lbPreview.src = previewUrl || '';
    DOM.lbPreview.classList.remove('hidden');
  }

  updateZoomUI();
  renderFilmstrip(imgs, index);
  prefetchAdjacentImages(imgs, index);

  // Phase 2: check blob cache (instant)
  const cached = cacheGet(image.id);
  if (cached) {
    if (state.lbRenderToken !== token) return;
    showLightboxImage(cached, token, image);
    return;
  }

  // Phase 3a: HEIC — convert first, then show
  if (image.isHeic && !browserSupportsHeic()) {
    const { fullBlobUrl } = await resolveHeicUrls(image);
    if (state.lbRenderToken !== token) return;
    if (fullBlobUrl) {
      cachePut(image.id, fullBlobUrl);
      showLightboxImage(fullBlobUrl, token, image);
    } else {
      DOM.lbSpinner.classList.add('hidden');
      DOM.lbError.classList.remove('hidden');
    }
    return;
  }

  // Phase 3b: non-HEIC — fetch to blob with size fallbacks
  loadLightboxWithFallback(LB_SIZES.slice(), 0, token, image);
}

function showLightboxImage(url, token, image) {
  if (state.lbRenderToken !== token) return;

  DOM.lbImg.onload = () => {
    if (state.lbRenderToken !== token) return;
    DOM.lbSpinner.classList.add('hidden');
    if (DOM.lbPreview) DOM.lbPreview.classList.add('hidden');
    DOM.lbImg.classList.remove('hidden');
    requestAnimationFrame(() => { DOM.lbImg.style.opacity = '1'; });
    applyLbTransform();
  };

  DOM.lbImg.onerror = () => {
    if (state.lbRenderToken !== token) return;
    DOM.lbSpinner.classList.add('hidden');
    DOM.lbError.classList.remove('hidden');
  };

  DOM.lbImg.alt = formatName(image.name);
  DOM.lbImg.src = url;
}

// IMPORTANT: Drive thumbnail URLs do NOT support CORS fetch().
// We must use img.src assignment (browsers exempt <img> from CORS).
// On onerror we cascade through smaller sizes exactly as the old
// working version did — no fetch(), no blobs, no CORS failure.
function loadLightboxWithFallback(sizes, attempt, token, image) {
  if (state.lbRenderToken !== token) return;
  if (attempt >= sizes.length) {
    DOM.lbSpinner.classList.add('hidden');
    DOM.lbError.classList.remove('hidden');
    return;
  }

  const sz  = sizes[attempt];
  const url = getFullImageUrl(image.id, sz);

  DOM.lbImg.onload = () => {
    if (state.lbRenderToken !== token) return;
    // Cache the working URL (as a plain Drive URL, not a blob)
    cachePut(image.id, url);
    DOM.lbSpinner.classList.add('hidden');
    if (DOM.lbPreview) DOM.lbPreview.classList.add('hidden');
    DOM.lbImg.classList.remove('hidden');
    requestAnimationFrame(() => { DOM.lbImg.style.opacity = '1'; });
    applyLbTransform();
  };

  DOM.lbImg.onerror = () => {
    if (state.lbRenderToken !== token) return;
    console.warn(`[Lightbox] sz=w${sz} failed (attempt ${attempt + 1}/${sizes.length}), trying next`);
    loadLightboxWithFallback(sizes, attempt + 1, token, image);
  };

  DOM.lbImg.alt = formatName(image.name);
  DOM.lbImg.src = url;
}

// ────────────────────────────────────────────────────────────
//  Filmstrip
// ────────────────────────────────────────────────────────────

function renderFilmstrip(imgs, currentIndex) {
  DOM.filmstrip.innerHTML = '';
  const frag = document.createDocumentFragment();

  imgs.forEach((img, i) => {
    const btn = document.createElement('button');
    btn.className = 'film-thumb' + (i === currentIndex ? ' active' : '');
    const thumbSrc = heicBlobCache.has(img.id)
      ? heicBlobCache.get(img.id).thumbnailBlobUrl || img.thumbnailUrl
      : img.thumbnailUrl;
    const thumbImg = document.createElement('img');
    thumbImg.src     = thumbSrc;
    thumbImg.alt     = '';
    thumbImg.loading = 'lazy';
    btn.appendChild(thumbImg);
    btn.addEventListener('click', () => navigateLightbox(i));
    frag.appendChild(btn);
  });

  DOM.filmstrip.appendChild(frag);
  requestAnimationFrame(() => {
    const active = DOM.filmstrip.querySelector('.film-thumb.active');
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  });
}

// ────────────────────────────────────────────────────────────
//  Zoom / pan
// ────────────────────────────────────────────────────────────

function lbZoomIn()  { state.lbZoom = Math.min(state.lbZoom + 0.5, 5); applyLbTransform(); updateZoomUI(); }
function lbZoomOut() {
  state.lbZoom = Math.max(state.lbZoom - 0.5, 1);
  if (state.lbZoom <= 1) state.lbPan = { x: 0, y: 0 };
  applyLbTransform(); updateZoomUI();
}
function lbResetZoom() { state.lbZoom = 1; state.lbPan = { x: 0, y: 0 }; applyLbTransform(); updateZoomUI(); }

function applyLbTransform() {
  const { lbZoom: z, lbPan: { x, y } } = state;
  DOM.lbImg.style.transform = `scale(${z}) translate(${x / z}px, ${y / z}px)`;
  DOM.lbStage.style.cursor  = z > 1 ? (state.lbDragging ? 'grabbing' : 'grab') : 'default';
}

function updateZoomUI() {
  DOM.lbZoomReset.textContent = `${Math.round(state.lbZoom * 100)}%`;
  DOM.lbZoomOut.disabled = state.lbZoom <= 1;
  DOM.lbZoomIn.disabled  = state.lbZoom >= 5;
}

// ────────────────────────────────────────────────────────────
//  Download
// ────────────────────────────────────────────────────────────

async function lbDownload() {
  const imgs  = getFilteredImages();
  const image = imgs[state.lightboxIndex];
  if (!image) return;
  if (image.isDemo) { window.open(image.fullUrl, '_blank'); return; }

  // HEIC: if we have a converted blob URL, use it for download
  if (image.isHeic && heicBlobCache.has(image.id)) {
    const { fullBlobUrl } = heicBlobCache.get(image.id);
    if (fullBlobUrl && fullBlobUrl.startsWith('blob:')) {
      const a = document.createElement('a');
      a.href = fullBlobUrl; a.download = image.name.replace(/\.heic$/i, '.jpg'); a.click();
      return;
    }
  }

  // For Drive images: open the highest-res thumbnail in a new tab.
  // Direct fetch() is blocked by Drive's CORS policy, so we cannot
  // create a programmatic download link — opening in a new tab is
  // the only reliable cross-browser approach without a proxy server.
  window.open(image.downloadUrl, '_blank');
}

// ────────────────────────────────────────────────────────────
//  Keyboard shortcuts
// ────────────────────────────────────────────────────────────

function onKeyDown(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (state.lightboxIndex === null) return;
  switch (e.key) {
    case 'Escape':      e.preventDefault(); closeLightbox(); break;
    case 'ArrowRight':  e.preventDefault(); navigateLightbox(state.lightboxIndex + 1); break;
    case 'ArrowLeft':   e.preventDefault(); navigateLightbox(state.lightboxIndex - 1); break;
    case '+': case '=': e.preventDefault(); lbZoomIn();    break;
    case '-':           e.preventDefault(); lbZoomOut();   break;
    case '0':           e.preventDefault(); lbResetZoom(); break;
  }
}

// ────────────────────────────────────────────────────────────
//  Formatters
// ────────────────────────────────────────────────────────────

function formatName(name) {
  return name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ────────────────────────────────────────────────────────────
//  Boot
// ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
