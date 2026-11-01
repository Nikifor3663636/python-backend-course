// Офлайн-режим сайта: оболочка приложения + однажды скачанный Python (Pyodide) лежат в кэше.
const SHELL = "pbc-shell-v1";
const RUNTIME = "pbc-runtime-v1";
const FILES = ["./", "index.html", "style.css", "app.js", "content.js", "worker.js", "py/shim.py",
  "vendor/marked.min.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Pyodide и пакеты PyPI неизменны по версии — сначала кэш
  if (/cdn\.jsdelivr\.net|files\.pythonhosted\.org|pypi\.org/.test(url.host)) {
    e.respondWith(caches.open(RUNTIME).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok && !url.host.startsWith("pypi.org")) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  // свои файлы — сначала сеть (чтобы обновления курса приходили), без сети — кэш
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) caches.open(SHELL).then((c) => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  }
});
