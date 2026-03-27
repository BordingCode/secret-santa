const CACHE = 'secret-santa-v1';
const ASSETS = [
  './',
  'index.html',
  'css/theme.css',
  'css/layout.css',
  'css/screens.css',
  'js/app.js',
  'manifest.json',
  'icons/favicon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
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
  url.search = '';
  const cleanReq = new Request(url.href, { headers: e.request.headers });

  e.respondWith(
    fetch(cleanReq).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(cache => cache.put(cleanReq, clone));
      return res;
    }).catch(() => caches.match(cleanReq))
  );
});
