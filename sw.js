// Bogotá Bici service worker: lets the app open and show the map with weak or no signal.
// - App files (this site): network first, so a new version arrives as soon as there is signal;
//   the saved copy is used when the network fails or takes more than 4 s.
// - MapLibre (unpkg): saved once, versioned URL.
// - Map style, tiles, fonts and icons (OpenFreeMap, OSM): the saved copy is shown at once and refreshed
//   in the background; at most ~2500 tiles are kept.
// Everything else (routes, reports, search, stats) goes straight to the network: the app handles those.
const VERSION = 'bb-v0.6.1';
const APP = 'bb-app-' + VERSION, LIB = 'bb-lib', MAP = 'bb-map';
const SHELL = ['./', 'index.html', 'app.js', 'i18n.js', 'style.css', 'icon.svg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'];
const LIBS = ['https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js', 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css'];
const MAP_HOSTS = ['tiles.openfreemap.org', 'tile.openstreetmap.org'];
const MAX_TILES = 2500;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const app = await caches.open(APP);
    await app.addAll(SHELL);
    try { await app.add('data/places.json'); } catch { /* fetched on first use */ }
    const lib = await caches.open(LIB);
    for (const u of LIBS) if (!(await lib.match(u))) { try { await lib.add(u); } catch { /* next time */ } }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('bb-app-') && k !== APP) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function networkFirst(req) {
  const cache = await caches.open(APP);
  const isPage = req.mode === 'navigate';
  try {
    const res = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 4000))]);
    if (res.ok) cache.put(isPage ? 'index.html' : req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(isPage ? 'index.html' : req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

let puts = 0;
async function staleWhileRevalidate(req) {
  const cache = await caches.open(MAP);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => {
    if (res.ok) {
      cache.put(req, res.clone());
      if (++puts % 200 === 0) trim(cache);
    }
    return res;
  }).catch(() => null);
  if (hit) return hit;
  const res = await fresh;
  return res || new Response('', { status: 504 });
}
async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(k);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === location.origin) { e.respondWith(networkFirst(req)); return; }
  if (u.host === 'unpkg.com') {
    e.respondWith(caches.open(LIB).then(async (c) => (await c.match(req)) || fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; })));
    return;
  }
  if (MAP_HOSTS.includes(u.host)) e.respondWith(staleWhileRevalidate(req));
});
