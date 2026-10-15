// Simpan aplikasi untuk dipakai tanpa sinyal setelah dibuka sekali.
// Rekaman suara disimpan di cache tersendiri yang TIDAK dihapus saat aplikasi diperbarui.
// Nomor versi APP diisi otomatis oleh build.py dari file VERSION.
const APP = 'literasi-app-v0.8.0';
const AUDIO = 'literasi-audio-v1';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
// Foto sampul: disimpan satu per satu (yang gagal tidak membatalkan pemasangan; halaman menghitung ulang yang tersimpan).
const IMG = ['img/arfak-teluk.webp','img/senja-rouwor.webp','img/dermaga-sumano.webp','img/mama-puskesmas.webp','img/bermain-saga.webp','img/kader-benawa.webp','img/anak-arfak.webp','img/perahu-sumano.webp','img/posyandu-benawa.webp','img/noken.webp'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(CORE).then(() => Promise.all(IMG.map(u => c.add(u).catch(() => {}))))).then(() => self.skipWaiting()));
});

// Hanya cache milik aplikasi ini (awalan literasi-app-) yang dibersihkan; cache aplikasi lain di origin yang sama dibiarkan.
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('literasi-app-') && k !== APP).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Pemutar audio meminta potongan file (header Range). Dari cache, kirim potongan yang diminta (206).
// Range yang tidak masuk akal (akhir sebelum awal, bentuk salah) ditolak dengan 416.
function ranged(req, res) {
  const range = req.headers.get('range');
  if (!range) return res;
  return res.blob().then(b => {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    const type = res.headers.get('Content-Type') || 'audio/mpeg';
    const bad = () => new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + b.size } });
    if (!m || (m[1] === '' && m[2] === '')) return bad();
    let start = m[1] === '' ? Math.max(0, b.size - Number(m[2])) : Number(m[1]);
    let end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), b.size - 1) : b.size - 1;
    if (start >= b.size || end < start) return bad();
    const part = b.slice(start, end + 1);
    return new Response(part, { status: 206, statusText: 'Partial Content', headers: {
      'Content-Type': type, 'Accept-Ranges': 'bytes',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + b.size, 'Content-Length': String(part.size) } });
  });
}

// Rekaman: kunci cache memakai alamat lengkap termasuk ?v=<sidik jari>, jadi rekaman baru dengan nama sama
// terunduh baru; versi lama dengan jalur sama dibuang. Permintaan "no-cache"/"reload" (tombol simpan ulang)
// dilayani dari jaringan dulu.
function audio(req) {
  const url = new URL(req.url), key = url.href, path = url.origin + url.pathname;
  const fresh = req.cache === 'no-cache' || req.cache === 'reload' || req.cache === 'no-store';
  return caches.open(AUDIO).then(c => {
    const fromNet = () => fetch(key).then(res => {
      if (res.status !== 200) return res;
      return c.keys().then(ks => Promise.all(ks.filter(k => k.url.split('?')[0] === path && k.url !== key).map(k => c.delete(k))))
        .then(() => c.put(key, res.clone())).catch(() => {}).then(() => ranged(req, res));
    });
    if (fresh) return fromNet().catch(() => c.match(key).then(hit => hit ? ranged(req, hit) : Response.error()));
    return c.match(key).then(hit => hit ? ranged(req, hit) : fromNet());
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/audio/') !== -1 && /\.mp3$/i.test(url.pathname)) { e.respondWith(audio(req)); return; }

  // Halaman dicocokkan tanpa parameter (?fbclid=… dari tautan yang dibagikan) dan selalu punya cadangan index.html.
  const nav = req.mode === 'navigate';
  const key = nav ? url.origin + url.pathname : req;
  const net = fetch(req).then(res => {
    if (res && res.status === 200) {
      const copy = res.clone();
      return caches.open(APP).then(c => c.put(key, copy)).catch(() => {}).then(() => res);
    }
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  e.respondWith(caches.match(key, { ignoreSearch: nav }).then(hit => hit || net.catch(() =>
    nav ? caches.match('index.html').then(r => r || caches.match('./')) : Response.error())));
});
