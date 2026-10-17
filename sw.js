/* JETCONTROL — service worker (app instalável + uso offline).
   Os dados continuam no localStorage; a sincronização com a nuvem
   (Firestore) NUNCA passa pelo cache. */
const VERSAO = 'jetcontrol-v3';
const SHELL = [
  './', 'index.html', 'cotas-extras.html', 'escalas.html', 'ciclos.html',
  'dashboard.html', 'resetar-dados.html', 'jetcontrol-sync.js',
  'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSAO).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;
  // Nuvem de sincronização: sempre direto na rede.
  if (/firestore\.googleapis\.com|firebase|googleapis\.com\/identitytoolkit/.test(url.hostname + url.pathname)) return;

  const mesmaOrigem = url.origin === self.location.origin;

  if (mesmaOrigem) {
    // Rede primeiro (sempre a versão mais nova), cache se estiver offline.
    e.respondWith(
      // 'no-cache' = sempre confere com o servidor (ETag) em vez de usar a cópia
      // que o navegador guardou por alguns minutos (o GitHub Pages guarda ~10 min).
      fetch(req.url, { cache: 'no-cache' }).then((res) => {
        if (res && res.ok) { const cp = res.clone(); caches.open(VERSAO).then((c) => c.put(req, cp)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
    );
    return;
  }

  // Bibliotecas externas (Tailwind, Chart.js, ícones, fontes): cache primeiro + atualização.
  e.respondWith(
    caches.match(req).then((cache) => {
      const rede = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) { const cp = res.clone(); caches.open(VERSAO).then((c) => c.put(req, cp)); }
        return res;
      }).catch(() => cache);
      return cache || rede;
    })
  );
});
