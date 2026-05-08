const CACHE = 'pathly-v1';
const ASSETS = [
  '/watsapp/pathly.html',
  '/watsapp/pathly-icon.svg',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

// Install — cache core assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

// Activate — delete old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — cache-first for app assets, network-first for tiles/API
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always go to network for map tiles, geocoding & routing APIs
  if (
    url.hostname.includes('cartocdn') ||
    url.hostname.includes('osrm') ||
    url.hostname.includes('nominatim') ||
    url.hostname.includes('photon') ||
    url.hostname.includes('openstreetmap')
  ) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Cache-first for app shell
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
