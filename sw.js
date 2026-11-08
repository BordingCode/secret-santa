const CACHE = 'secret-santa-v12';
const ASSETS = [
  './',
  'index.html',
  'css/theme.css',
  'css/layout.css',
  'css/screens.css',
  'js/app.js',
  'js/wishes.js',
  'manifest.json',
  'icons/favicon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    // cache: 'reload' goes to the network: the browser's own copy may still be the old version.
    caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' }))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Saving wishes goes to another site by POST: rebuilding it below would drop its contents.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  url.search = '';
  const cleanReq = new Request(url.href, { headers: e.request.headers });

  e.respondWith(
    // cache: 'no-cache' asks the server whether there's a newer file, so an update shows up at once.
    fetch(cleanReq, { cache: 'no-cache' }).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(cache => cache.put(cleanReq, clone));
      return res;
    }).catch(() => caches.match(cleanReq))
  );
});

// hub-stats tracker v2
