/* ============================================================
   CLTV Tool — Service Worker
   Cache-first strategy for offline use
   ============================================================ */

const CACHE_NAME = 'cltv-tool-v1';
const STATIC_CACHE = 'cltv-static-v1';

/* Resources to cache on install */
const PRECACHE_URLS = [
  './Taproot3.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  /* External CDN resources cached on first fetch */
];

/* CDN origins to cache when fetched */
const CDN_ORIGINS = [
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

/* ── INSTALL ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return cache.addAll(PRECACHE_URLS).catch(err => {
        console.warn('[SW] Precache partial failure (normal if icons missing):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

/* ── ACTIVATE ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== STATIC_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── FETCH ── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  /* Skip non-GET, chrome-extension, and API calls */
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  /* Mempool API calls — network only, no cache (live data) */
  if (url.hostname.includes('mempool.space') || url.hostname.includes('blockstream.info')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'أنت غير متصل بالإنترنت' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  /* CDN resources — cache first, then network */
  const isCDN = CDN_ORIGINS.some(o => url.hostname.includes(o));
  if (isCDN) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        }).catch(() => cached || new Response('', { status: 503 }));
      })
    );
    return;
  }

  /* App files — cache first, then network, then offline fallback */
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const clone = response.clone();
        caches.open(STATIC_CACHE).then(cache => cache.put(request, clone));
        return response;
      }).catch(() => {
        /* Offline fallback: return cached main page */
        if (request.destination === 'document') {
          return caches.match('./Taproot3.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

/* ── BACKGROUND SYNC (optional future use) ── */
self.addEventListener('sync', event => {
  console.log('[SW] Background sync:', event.tag);
});
