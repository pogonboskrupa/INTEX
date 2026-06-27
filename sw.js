// Service worker za "Moj bazen" — omogućava instalaciju i offline rad.
const CACHE = "moj-bazen-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* ---------------- Podsjetnici u pozadini ---------------- */

const IDB_NAME = "mojbazen", IDB_STORE = "kv";
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function idbGet(key) {
  return idbOpen().then((db) => new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const rq = tx.objectStore(IDB_STORE).get(key);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  }));
}
function idbSet(key, val) {
  return idbOpen().then((db) => new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  }));
}

async function checkAndNotify() {
  const state = await idbGet("reminders").catch(() => null);
  if (!state || !Array.isArray(state.tasks)) return;
  const now = Date.now();
  const due = state.tasks.filter((t) => t.dueAt <= now);
  if (due.length === 0) return;

  const today = new Date().toISOString().slice(0, 10);
  const last = await idbGet("notifyLast").catch(() => null);
  if (last === today) return; // najviše jednom dnevno

  const body = due.slice(0, 5).map((t) => `${t.icon} ${t.label}`).join("\n") + (due.length > 5 ? "\n…" : "");
  await self.registration.showNotification(
    `Bazen: ${due.length} ${due.length === 1 ? "zadatak čeka" : "zadataka čeka"}`,
    { body, icon: "icon-192.png", badge: "icon-192.png", tag: "pool-reminder", renotify: true }
  );
  await idbSet("notifyLast", today).catch(() => {});
}

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "pool-reminders") event.waitUntil(checkAndNotify());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow("./index.html");
    })
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Za navigaciju: prvo mreža, pa cache (offline fallback).
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Ostali resursi: cache-first uz osvježavanje u pozadini.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
