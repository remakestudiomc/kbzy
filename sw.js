/* ============================================================
   Service Worker — офлайн-режим и установка PWA
   ============================================================ */

const CACHE_NAME = 'kbzy-cache-v3';

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/db.js',
  './js/api.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

/* ---------- Установка ---------- */

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

/* ---------- Активация ---------- */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ---------- Запросы ---------- */

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Не кешируем запросы к API
  if (request.url.includes('generativelanguage.googleapis.com')) return;

  // Только GET
  if (request.method !== 'GET') return;

  // Стратегия: cache-first, fallback на сеть, затем на кеш
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          // Кешируем успешные ответы
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Офлайн: для навигации возвращаем index.html
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Офлайн-режим', { status: 503, statusText: 'Offline' });
        });
    })
  );
});