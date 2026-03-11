// ============================================================
// ICF-SL Tool Launcher — Service Worker
// ============================================================
// HOW CACHING WORKS:
//
//   CORE FILES  → pre-cached on install (always available offline)
//   TOOL FILES  → cached automatically the first time a user
//                 opens a tool (HTML, CSV, images, JS, fonts…)
//                 After that first online visit, they work
//                 fully offline forever.
//
// TO PUSH AN UPDATE TO USERS:
//   Just bump CACHE_VERSION by 1. The "Update Now" toast will
//   appear for users still on the old version.
// ============================================================

const CACHE_VERSION   = 1;
const CACHE_CORE      = 'icf-core-v'    + CACHE_VERSION;
const CACHE_TOOLS     = 'icf-tools-v'   + CACHE_VERSION;
const CACHE_EXTERNAL  = 'icf-external-v'+ CACHE_VERSION;
const ALL_CACHES      = [CACHE_CORE, CACHE_TOOLS, CACHE_EXTERNAL];

// ── Core files: pre-cached on install ────────────────────────
// Only the launcher shell + its direct dependencies.
// Tool files are cached automatically at runtime (see below).
const CORE_ASSETS = [
  './',
  './icf-tool-launcher.html',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg',
  'https://github.com/mohamedsillahkanu/gdp-dashboard-2/raw/6c7463b0d5c3be150aafae695a4bcbbd8aeb1499/ICF-SL.jpg',
  'https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600;700&display=swap',
];

// ── Install ───────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing v' + CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_CORE)
      .then(cache =>
        Promise.allSettled(
          CORE_ASSETS.map(url =>
            fetch(url, { mode: 'no-cors' })
              .then(res => { if (res) cache.put(url, res); })
              .catch(err => console.warn('[SW] Could not pre-cache:', url, err))
          )
        )
      )
      .then(() => {
        console.log('[SW] Core assets cached');
        return self.skipWaiting();
      })
  );
});

// ── Activate: delete ALL old caches ──────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating v' + CACHE_VERSION);
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names
          .filter(name => !ALL_CACHES.includes(name))
          .map(name => {
            console.log('[SW] Removing old cache:', name);
            return caches.delete(name);
          })
      ))
      .then(() => {
        console.log('[SW] Ready — controlling all clients');
        return self.clients.claim();
      })
  );
});

// ── Fetch: smart routing ──────────────────────────────────────
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // Never intercept Google Apps Script or analytics
  if (url.includes('script.google.com'))   return;
  if (url.includes('google-analytics.com')) return;

  // Route to correct strategy
  if (isCoreAsset(url))     { event.respondWith(cacheFirst(event.request, CACHE_CORE));     return; }
  if (isExternalAsset(url)) { event.respondWith(cacheFirst(event.request, CACHE_EXTERNAL)); return; }
  if (isToolAsset(url))     { event.respondWith(networkFirstThenCache(event.request, CACHE_TOOLS)); return; }

  // Default: network first
  event.respondWith(networkFirstThenCache(event.request, CACHE_TOOLS));
});

// ── Helpers: classify request ────────────────────────────────
function isCoreAsset(url) {
  return (
    url.includes('icf-tool-launcher.html') ||
    url.includes('manifest.json') ||
    url.includes('icon-192') ||
    url.includes('icon-512') ||
    url.includes('ICF-SL.jpg') ||
    url.endsWith('sw.js')
  );
}

function isExternalAsset(url) {
  const externalHosts = [
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'unpkg.com',
    'flagcdn.com',
    'github.com',
    'raw.githubusercontent.com',
  ];
  return externalHosts.some(host => url.includes(host));
}

function isToolAsset(url) {
  // Local files: html, csv, js, json, images, fonts
  const localExtensions = [
    '.html', '.htm', '.csv', '.json',
    '.js',   '.css',
    '.png',  '.jpg', '.jpeg', '.gif', '.svg', '.webp',
    '.mp4',  '.webm',
    '.woff', '.woff2', '.ttf',
  ];
  try {
    const path = new URL(url).pathname;
    return localExtensions.some(ext => path.endsWith(ext));
  } catch { return false; }
}

// ── Caching strategies ────────────────────────────────────────

// Cache-first: serve from cache, only hit network if not cached.
// Best for: core shell, external libraries, fonts (stable content).
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) {
    console.log('[SW] Cache hit:', request.url);
    return cached;
  }
  try {
    const response = await fetch(request, { mode: 'no-cors' });
    if (response) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.warn('[SW] Offline, no cache for:', request.url);
    // Return offline page for HTML navigations
    if (request.headers.get('accept')?.includes('text/html')) {
      return caches.match('./icf-tool-launcher.html');
    }
  }
}

// Network-first then cache: try network, fall back to cache.
// Best for: tool HTML + CSV files (so edits reach users when online,
// but still work when offline using last cached version).
async function networkFirstThenCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
      console.log('[SW] Cached from network:', request.url);
    }
    return response;
  } catch {
    // Offline — serve cached version
    const cached = await caches.match(request);
    if (cached) {
      console.log('[SW] Offline, serving cache:', request.url);
      return cached;
    }
    // Nothing cached, nothing on network
    if (request.headers.get('accept')?.includes('text/html')) {
      return caches.match('./icf-tool-launcher.html');
    }
  }
}

// ── Messages from main thread ────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    console.log('[SW] Applying update now');
    self.skipWaiting();
  }
});
