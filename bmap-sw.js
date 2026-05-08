const CACHE = 'bmap-v3';
const SHELL = ['/watsapp/bmap-icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(()=>{})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n=>n!==CACHE).map(n=>caches.delete(n))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.hostname.includes('cartocdn')||u.hostname.includes('osrm')||u.hostname.includes('nominatim')||u.hostname.includes('photon')||u.hostname.includes('unpkg')||u.hostname.includes('openstreetmap')) { e.respondWith(fetch(e.request).catch(()=>new Response('',{status:503}))); return; }
  // Network-first for HTML files so updates always load
  if (e.request.destination==='document'||u.pathname.endsWith('.html')) {
    e.respondWith(fetch(e.request).then(r=>{if(r.ok){const cl=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cl));}return r;}).catch(()=>caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(resp => { if(resp.ok){const cl=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,cl));} return resp; })));
});
