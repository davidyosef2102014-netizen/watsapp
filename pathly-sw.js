const CACHE = 'pathly-v3';
const SHELL = [
  '/watsapp/pathly-icon.svg',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

// Install — cache static assets (NOT the HTML — always fetch fresh)
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

// Activate — delete ALL old caches immediately
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy:
// - HTML files → network-first (always get latest update)
// - Map tiles, APIs → network only
// - Other static assets → cache-first
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Network-only for tiles and APIs
  if (
    url.hostname.includes('cartocdn') ||
    url.hostname.includes('osrm') ||
    url.hostname.includes('nominatim') ||
    url.hostname.includes('photon') ||
    url.hostname.includes('openstreetmap') ||
    url.hostname.includes('unpkg')
  ) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Network-first for HTML — always loads the latest version
  if (e.request.destination === 'document' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for other static assets (icons, CSS)
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
      if (resp.ok) {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return resp;
    }))
  );
});
