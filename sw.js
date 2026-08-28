/* =========================================================
   sw.js — Service Worker
   一度オンラインで開けば、以後ネットが無くても Safari で起動できるようにする。
   （HTTPS または localhost でのみ動作。GitHub Pages は HTTPS なので有効）
   ========================================================= */

var CACHE = 'pq-shell-v1';
var API_CACHE = 'pq-api-v1';

var SHELL = [
  './',
  './index.html',
  './css/dex.css',
  './css/screens.css',
  './js/state.js',
  './js/dexdata.js',
  './js/pokeapi.js',
  './js/judge.js',
  './js/canvas.js',
  './js/sfx.js',
  './js/app.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(SHELL);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE && k !== API_CACHE) return caches.delete(k);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  /* 自分自身のファイル：キャッシュ優先（オフラインでも起動できる） */
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        }).catch(function () {
          return caches.match('./index.html');
        });
      })
    );
    return;
  }

  /* PokeAPI と公式イラスト：ネット優先、失敗したらキャッシュ（保険の二重化） */
  if (/pokeapi\.co|raw\.githubusercontent\.com/.test(url.hostname)) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(API_CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req);
      })
    );
  }
});
