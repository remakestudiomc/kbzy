/* ============================================================
   Service Worker — офлайн-режим и установка PWA
   Стратегия: network-first — всегда берём свежую версию с сервера,
   кеш используем только если сеть недоступна (офлайн).
   ============================================================ */

const CACHE_NAME = 'kbzy-cache-v6';

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
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* ---------- Активация ---------- */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ---------- Запросы: network-first ---------- */

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Не кешируем запросы к API Gemini
  if (request.url.includes('generativelanguage.googleapis.com')) return;

  // Только GET
  if (request.method !== 'GET') return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Если ответ успешный — обновляем кеш
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        // Офлайн: берём из кеша
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          // Навигация офлайн — index.html
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Офлайн-режим', { status: 503, statusText: 'Offline' });
        });
      })
  );
});