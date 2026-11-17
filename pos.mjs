// Pemosting mandiri Zuro Studio (tanpa dependensi, Node 18+). TIDAK berisi rahasia.
// Baca jadwal.json di folder ini, terbitkan item yang tanggalnya HARI INI (WIB) ke Instagram + Facebook Page.
//   node pos.mjs --uji     -> hanya cek, tidak menerbitkan
//   node pos.mjs           -> terbitkan item yang jatuh tempo
// Kunci dari environment variable: IG_USER_ID, IG_PAGE_TOKEN, FB_PAGE_ID, FB_PAGE_TOKEN
// (opsional kabar Telegram: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)
import fs from 'node:fs';

const G = 'https://graph.facebook.com/v21.0';
const E = process.env;
const UJI = process.argv.includes('--uji');
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const wib = E.TANGGAL_UJI || new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

async function api(metode, url, body) {
  const r = await fetch(url, {
    method: metode,
    headers: body ? {'content-type': 'application/x-www-form-urlencoded'} : undefined,
    body: body ? new URLSearchParams(body) : undefined,
  });
  const j = await r.json();
  if (j.error) throw new Error(`Meta API: ${j.error.message} (kode ${j.error.code})`);
  return j;
}

async function kabari(teks) {
  console.log(teks);
  if (!E.TELEGRAM_BOT_TOKEN || !E.TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${E.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({chat_id: E.TELEGRAM_CHAT_ID, text: teks}),
  }).catch(() => {});
}

async function tunggu(id) {
  for (let i = 0; i < 60; i++) {
    const s = await api('GET', `${G}/${id}?fields=status_code,status&access_token=${E.IG_PAGE_TOKEN}`);
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Kontainer ${s.status_code}: ${s.status || ''}`);
    await tidur(5000);
  }
  throw new Error('Kontainer IG belum selesai setelah ±5 menit');
}

async function sudahTerbit(caption) {
  const r = await api('GET', `${G}/${E.IG_USER_ID}/media?fields=caption&limit=15&access_token=${E.IG_PAGE_TOKEN}`);
  const kunci = caption.slice(0, 60);
  return (r.data || []).some((m) => (m.caption || '').startsWith(kunci));
}

async function instagram(it) {
  const T = E.IG_PAGE_TOKEN;
  let k;
  if (it.jenis === 'carousel') {
    const anak = [];
    for (const u of it.media) anak.push((await api('POST', `${G}/${E.IG_USER_ID}/media`, {image_url: u, is_carousel_item: 'true', access_token: T})).id);
    for (const a of anak) await tunggu(a);
    k = (await api('POST', `${G}/${E.IG_USER_ID}/media`, {media_type: 'CAROUSEL', children: anak.join(','), caption: it.caption, access_token: T})).id;
  } else {
    const p = {media_type: 'REELS', video_url: it.media[0], caption: it.caption, share_to_feed: 'true', access_token: T};
    if (it.cover) p.cover_url = it.cover;
    k = (await api('POST', `${G}/${E.IG_USER_ID}/media`, p)).id;
  }
  await tunggu(k);
  if (UJI) return `kontainer ${k} siap (uji, tidak terbit)`;
  const pub = await api('POST', `${G}/${E.IG_USER_ID}/media_publish`, {creation_id: k, access_token: T});
  const info = await api('GET', `${G}/${pub.id}?fields=permalink&access_token=${T}`).catch(() => ({}));
  return info.permalink || pub.id;
}

async function facebook(it) {
  const T = E.FB_PAGE_TOKEN, P = E.FB_PAGE_ID;
  if (UJI) return `Halaman "${(await api('GET', `${G}/${P}?fields=name&access_token=${T}`)).name}" bisa diakses`;
  let h;
  if (it.jenis === 'carousel') {
    const foto = [];
    for (const u of it.media) foto.push((await api('POST', `${G}/${P}/photos`, {url: u, published: 'false', access_token: T})).id);
    const att = Object.fromEntries(foto.map((f, i) => [`attached_media[${i}]`, JSON.stringify({media_fbid: f})]));
    h = await api('POST', `${G}/${P}/feed`, {message: it.caption, ...att, access_token: T});
  } else h = await api('POST', `${G}/${P}/videos`, {file_url: it.media[0], description: it.caption, access_token: T});
  return h.id || h.post_id;
}

for (const k of ['IG_USER_ID', 'IG_PAGE_TOKEN', 'FB_PAGE_ID', 'FB_PAGE_TOKEN']) {
  if (!E[k]) { await kabari(`Pemosting Zuro BERHENTI: variabel ${k} belum diisi di environment.`); process.exit(1); }
}
const jadwal = JSON.parse(fs.readFileSync(new URL('./jadwal.json', import.meta.url), 'utf8'));
const jatuhTempo = jadwal.filter((x) => x.tanggal === wib);
console.log(`Hari ini (WIB) ${wib}: ${jatuhTempo.length} item jatuh tempo${UJI ? ' [MODE UJI]' : ''}.`);
let gagal = false;
for (const it of jatuhTempo) {
  try {
    if (!UJI && (await sudahTerbit(it.caption))) { console.log(`Lewati ${it.id}: sudah terbit.`); continue; }
    const ig = await instagram(it);
    const fb = await facebook(it);
    await kabari(`${UJI ? 'Uji OK' : 'Sudah tayang'}: ${it.judul}\nIG: ${ig}\nFB: ${fb}`);
  } catch (e) {
    gagal = true;
    await kabari(`GAGAL posting ${it.id}: ${e.message}\nPosting ulang manual atau jalankan lagi.`);
  }
}
process.exit(gagal ? 1 : 0);
