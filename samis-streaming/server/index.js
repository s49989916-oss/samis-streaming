/**
 * Sami's Streaming — secure API gateway.
 * All secrets live in process.env and NEVER reach the client bundle.
 */
import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { findSources, rankSources } from './sources.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(compression());
app.use(express.json({ limit: '1mb' }));

/* The Android / Android TV APK bundles the UI and calls this server from the
   WebView origin (capacitor://localhost), so /api needs permissive CORS.
   Only the proxy is exposed — API keys never leave this process. */
app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const PORT = process.env.PORT || 8787;
const clean = (v) => {
  const s = String(v || '').trim();
  // Treat the .env.example placeholders as "not configured".
  return /^your_|^$|^<.*>$/i.test(s) ? '' : s;
};
const TMDB_KEY = clean(process.env.TMDB_API_KEY);
const TMDB_TOKEN = clean(process.env.TMDB_READ_TOKEN);
const TORBOX_KEY = clean(process.env.TORBOX_API_KEY);
const TORBOX_BASE = process.env.TORBOX_API_BASE || 'https://api.torbox.app/v1';
// Opt-in: hand the raw signed CDN url to the browser (fastest, but the url contains your token).
const DIRECT_STREAM = String(process.env.DIRECT_STREAM || '').toLowerCase() === 'true';
// Optional: if ffmpeg is on PATH we can remux/transcode anything the browser refuses.
const FFMPEG = (() => {
  const bin = process.env.FFMPEG_PATH || 'ffmpeg';
  try { return spawnSync(bin, ['-version']).status === 0 ? bin : null; } catch { return null; }
})();
const FFPROBE = (() => {
  const guess = process.env.FFPROBE_PATH
    || (FFMPEG && FFMPEG !== 'ffmpeg' ? FFMPEG.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1') : 'ffprobe');
  try { return spawnSync(guess, ['-version']).status === 0 ? guess : null; } catch { return null; }
})();
const SELF = () => `http://127.0.0.1:${PORT}`;

/* ------------------------------ tiny TTL cache ----------------------------- */
const cache = new Map();
const getCached = (k) => {
  const hit = cache.get(k);
  if (!hit) return null;
  if (Date.now() > hit.exp) { cache.delete(k); return null; }
  return hit.val;
};
const setCached = (k, val, ttl = 300_000) => cache.set(k, { val, exp: Date.now() + ttl });

async function safeFetch(url, opts = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20_000);
      const r = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(t);
      const text = await r.text();
      let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
      if (!r.ok) {
        // 4xx = don't retry (bad key / not found)
        if (r.status >= 400 && r.status < 500 && r.status !== 429) {
          return { ok: false, status: r.status, body };
        }
        lastErr = new Error(`HTTP ${r.status}`);
      } else {
        return { ok: true, status: r.status, body };
      }
    } catch (e) { lastErr = e; }
    await new Promise((res) => setTimeout(res, 400 * (i + 1)));
  }
  return { ok: false, status: 502, body: { error: String(lastErr?.message || lastErr) } };
}

/* --------------------------------- health --------------------------------- */
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    tmdb: Boolean(TMDB_KEY || TMDB_TOKEN),
    torbox: Boolean(TORBOX_KEY),
    ffmpeg: Boolean(FFMPEG && FFPROBE),
    directStream: DIRECT_STREAM,
    time: new Date().toISOString(),
  });
});

/* ---------------------------------- TMDB ---------------------------------- */
// Generic passthrough: /api/tmdb/<tmdb path>?<params>
app.get(/^\/api\/tmdb\/(.+)/, async (req, res) => {
  if (!TMDB_KEY && !TMDB_TOKEN) {
    return res.status(503).json({ error: 'TMDB_API_KEY missing. Add it to .env and restart.' });
  }
  const sub = req.params[0];
  const params = new URLSearchParams(req.query);
  if (!params.has('language')) params.set('language', 'en-US');
  if (TMDB_KEY) params.set('api_key', TMDB_KEY);
  const url = `https://api.themoviedb.org/3/${sub}?${params.toString()}`;
  const key = 'tmdb:' + url;
  const hit = getCached(key);
  if (hit) return res.json(hit);

  const headers = TMDB_TOKEN ? { Authorization: `Bearer ${TMDB_TOKEN}` } : {};
  const r = await safeFetch(url, { headers });
  if (!r.ok) return res.status(r.status).json({ error: 'TMDB request failed', detail: r.body });
  setCached(key, r.body, 10 * 60_000);
  res.json(r.body);
});

/* --------------------------------- TorBox --------------------------------- */
const VIDEO_RE = /\.(mkv|mp4|avi|m4v|mov|webm|ts|m2ts|flv|wmv|mpg|mpeg)$/i;
const SUB_RE = /\.(srt|vtt|ass|ssa|sub)$/i;
const tb = (p) => `${TORBOX_BASE}${p}`;
const tbHeaders = () => ({ Authorization: `Bearer ${TORBOX_KEY}`, Accept: 'application/json' });



function normalizeList(kind, items) {
  return (items || []).map((it) => ({
    kind, // torrent | usenet | webdl
    id: it.id,
    name: it.name || it.hash || `#${it.id}`,
    hash: it.hash,
    size: it.size,
    createdAt: it.created_at,
    cached: it.download_present ?? it.cached ?? true,
    finished: it.download_finished ?? true,
    progress: it.progress ?? 1,
    files: (it.files || [])
      .map((f) => ({
        id: f.id,
        name: f.short_name || f.name,
        path: f.name,
        size: f.size,
        mime: f.mimetype,
        isVideo: VIDEO_RE.test(f.name || '') || String(f.mimetype || '').startsWith('video'),
        isSub: SUB_RE.test(f.name || ''),
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true })),
  }));
}

/** Shape a raw checkcached file the same way the cloud list does. */
function normalizeFile(f) {
  return {
    id: f.id,
    name: f.short_name || f.name,
    path: f.name,
    size: f.size,
    mime: f.mimetype,
    isVideo: VIDEO_RE.test(f.name || '') || String(f.mimetype || '').startsWith('video'),
    isSub: SUB_RE.test(f.name || ''),
  };
}

async function fetchList(kind, pathname) {
  const r = await safeFetch(tb(`${pathname}?bypass_cache=true`), { headers: tbHeaders() });
  if (!r.ok) return { kind, error: r.body?.detail || r.body?.error || `HTTP ${r.status}`, items: [] };
  const data = r.body?.data;
  return { kind, items: normalizeList(kind, Array.isArray(data) ? data : data ? [data] : []) };
}

// Full cloud: torrents + usenet + web downloads, all merged.
app.get('/api/cloud', async (_req, res) => {
  if (!TORBOX_KEY) return res.status(503).json({ error: 'TORBOX_API_KEY missing. Add it to .env and restart.' });
  const key = 'cloud';
  const hit = getCached(key);
  if (hit) return res.json(hit);

  const [t, u, w] = await Promise.all([
    fetchList('torrent', '/api/torrents/mylist'),
    fetchList('usenet', '/api/usenet/mylist'),
    fetchList('webdl', '/api/webdl/mylist'),
  ]);
  const errors = [t, u, w].filter((x) => x.error).map((x) => `${x.kind}: ${x.error}`);
  const items = [...t.items, ...u.items, ...w.items]
    .map((i) => ({ ...i, hasVideo: i.files.some((f) => f.isVideo) || i.files.length === 0 }))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const payload = { items, errors, counts: { torrent: t.items.length, usenet: u.items.length, webdl: w.items.length } };
  setCached(key, payload, 60_000);
  res.json(payload);
});

/* Signed CDN URLs from TorBox embed the API token. We therefore never hand them
   to the browser: they are kept in a short-lived server-side ticket table and the
   client receives an opaque /api/play/<ticket> URL instead. */
const tickets = new Map();
const TICKET_TTL = 6 * 60 * 60 * 1000;
function makeTicket(url) {
  const id = crypto.randomUUID();
  tickets.set(id, { url, exp: Date.now() + TICKET_TTL });
  if (tickets.size > 500) {
    for (const [k, v] of tickets) if (v.exp < Date.now()) tickets.delete(k);
  }
  return id;
}
const readTicket = (id) => {
  const t = tickets.get(id);
  if (!t || t.exp < Date.now()) return null;
  return t.url;
};

// Direct stream link. kind decides which request-dl endpoint is used.
app.get('/api/stream', async (req, res) => {
  if (!TORBOX_KEY) return res.status(503).json({ error: 'TORBOX_API_KEY missing.' });
  const { kind = 'torrent', id, fileId } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });

  const map = {
    torrent: { path: '/api/torrents/requestdl', idKey: 'torrent_id' },
    usenet: { path: '/api/usenet/requestdl', idKey: 'usenet_id' },
    webdl: { path: '/api/webdl/requestdl', idKey: 'web_id' },
  };
  const conf = map[kind] || map.torrent;
  const qs = new URLSearchParams({ token: TORBOX_KEY, [conf.idKey]: String(id), redirect: 'false' });
  if (fileId !== undefined && fileId !== '') qs.set('file_id', String(fileId));

  let r = await safeFetch(tb(`${conf.path}?${qs.toString()}`), { headers: tbHeaders() });
  // Legacy hyphenated route fallback (older TorBox deployments).
  if (!r.ok) {
    const legacy = conf.path.replace('requestdl', 'request-dl');
    r = await safeFetch(tb(`${legacy}?${qs.toString()}`), { headers: tbHeaders() });
  }
  if (!r.ok) {
    return res.status(r.status).json({ error: 'Could not get a stream link', detail: r.body?.detail || r.body });
  }
  const url = r.body?.data?.url || r.body?.data || r.body?.url;
  if (!url || typeof url !== 'string') {
    return res.status(502).json({ error: 'TorBox returned no link', detail: r.body });
  }
  const ticket = makeTicket(url);
  // `raw` is only used by trusted server-side helpers (never sent to the UI).
  res.json({ url: `/api/play/${ticket}`, ticket, direct: DIRECT_STREAM ? url : undefined });
});

// Subtitle proxy + SRT→VTT conversion (fixes CORS + unsupported format in <track>).
app.get('/api/subtitle', async (req, res) => {
  const src = req.query.ticket ? readTicket(req.query.ticket) : req.query.url;
  if (!src) return res.status(400).send('url or ticket required');
  try {
    const r = await fetch(String(src));
    if (!r.ok) return res.status(r.status).send('subtitle fetch failed');
    let text = await r.text();
    if (!/^WEBVTT/.test(text.trim())) {
      text = 'WEBVTT\n\n' + text
        .replace(/\r+/g, '')
        .replace(/^\uFEFF/, '')
        .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    }
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.send(text);
  } catch (e) {
    res.status(502).send('subtitle error');
  }
});

/* --------------------- universal catalogue: find + auto-add -------------------- */

const VID = VIDEO_RE;

/** Ask TorBox which of these hashes are already cached (instant play) + their files. */
async function checkCached(hashes) {
  if (!hashes.length) return {};
  const out = {};
  for (let i = 0; i < hashes.length; i += 40) {
    const chunk = hashes.slice(i, i + 40);
    const r = await safeFetch(tb('/api/torrents/checkcached?format=object&list_files=true'), {
      method: 'POST',
      headers: { ...tbHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes: chunk }),
    }, 2);
    if (r.ok && r.body?.data && !Array.isArray(r.body.data)) Object.assign(out, r.body.data);
  }
  return out;
}

// GET /api/sources?imdb=tt1375666&title=Inception&year=2010[&season=&episode=][&langs=hindi,urdu][&dubbed=1]
app.get('/api/sources', async (req, res) => {
  if (!TORBOX_KEY) return res.status(503).json({ error: 'TORBOX_API_KEY missing.' });
  const { imdb, title, year, season, episode, langs, dubbed, esub, alt } = req.query;
  const key = `src:${imdb || ''}:${title || ''}:${year || ''}:${season || ''}:${episode || ''}:${langs || ''}:${dubbed || ''}`;
  const hit = getCached(key);
  if (hit) return res.json(hit);

  const want = {
    langs: String(langs || '').split(',').filter(Boolean),
    dubbed: dubbed === '1' || dubbed === 'true',
    esub: esub === '1' || esub === 'true',
  };
  let list = await findSources({
    imdb, title, year,
    season: season !== undefined && season !== '' ? Number(season) : undefined,
    episode: episode !== undefined && episode !== '' ? Number(episode) : undefined,
    apiKey: TORBOX_KEY, want,
    altTitles: String(alt || '').split('|').filter(Boolean),
  });
  list = list.slice(0, 40);

  // enrich with real TorBox cache status + file list, then re-rank
  const cache = await checkCached(list.map((s) => s.hash));
  for (const s of list) {
    const c = cache[s.hash] || cache[s.hash?.toLowerCase()];
    if (c) {
      s.cached = true;
      s.size = s.size || c.size;
      s.files = (c.files || [])
        .filter((f) => VID.test(f.name || ''))
        .map((f) => ({ id: f.id, name: f.short_name || f.name, path: f.name, size: f.size }));
    }
  }
  const ranked = rankSources(list, { ...want, season, episode }).slice(0, 25);
  const payload = { sources: ranked, instant: ranked.filter((s) => s.cached).length };
  setCached(key, payload, 5 * 60_000);
  res.json(payload);
});

/** Add a magnet to the cloud (instant when cached) and return its torrent id. */
app.post('/api/add', async (req, res) => {
  if (!TORBOX_KEY) return res.status(503).json({ error: 'TORBOX_API_KEY missing.' });
  const { hash, name } = req.body || {};
  if (!hash) return res.status(400).json({ error: 'hash required' });

  const magnet = `magnet:?xt=urn:btih:${hash}${name ? `&dn=${encodeURIComponent(name)}` : ''}` +
    '&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce' +
    '&tr=udp%3A%2F%2Fopen.demonii.com%3A1337%2Fannounce' +
    '&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce';

  const form = new FormData();
  form.append('magnet', magnet);
  form.append('seed', '3');
  form.append('allow_zip', 'false');
  const r = await safeFetch(tb('/api/torrents/createtorrent'), {
    method: 'POST', headers: { Authorization: `Bearer ${TORBOX_KEY}` }, body: form,
  }, 2);
  if (!r.ok) {
    return res.status(r.status).json({ error: r.body?.detail || 'TorBox refused this torrent', detail: r.body });
  }
  cache.delete('cloud');
  const id = r.body?.data?.torrent_id ?? r.body?.data?.id;
  const realHash = (r.body?.data?.hash || hash || '').toLowerCase();
  const cached = /cached/i.test(r.body?.detail || '');

  // For an instant (cached) add we already know the file list from checkcached,
  // so hand it straight back and let the client skip polling entirely.
  let files = null;
  if (cached) {
    try {
      const map = await checkCached([realHash]);
      const f = map[realHash]?.files;
      if (Array.isArray(f) && f.length) files = f.map(normalizeFile);
    } catch { /* fall back to polling */ }
  }
  res.json({ id, hash: realHash, detail: r.body?.detail, cached, files });
});

/** Poll a single torrent: progress + file list, so the UI can wait gracefully. */
app.get('/api/torrent/:id', async (req, res) => {
  if (!TORBOX_KEY) return res.status(503).json({ error: 'TORBOX_API_KEY missing.' });
  const r = await safeFetch(tb(`/api/torrents/mylist?id=${req.params.id}&bypass_cache=true`), { headers: tbHeaders() });
  if (!r.ok) return res.status(r.status).json({ error: 'not found' });
  const d = r.body?.data;
  if (!d) return res.status(404).json({ error: 'not found' });
  res.json(normalizeList('torrent', [d])[0]);
});

/* ----------------------- ticketed playback (range proxy) ---------------------- */
async function pipeRange(srcUrl, req, res) {
  const headers = {};
  if (req.headers.range) headers.Range = req.headers.range;
  const upstream = await fetch(srcUrl, { headers, redirect: 'follow' });
  res.status(upstream.status);
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (!upstream.headers.get('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
  if (!upstream.body) return res.end();
  const stream = Readable.fromWeb(upstream.body);
  req.on('close', () => stream.destroy());
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

app.get('/api/play/:ticket', async (req, res) => {
  const url = readTicket(req.params.ticket);
  if (!url) return res.status(410).json({ error: 'This stream ticket expired. Press play again.' });
  try { await pipeRange(url, req, res); } catch { res.status(502).end(); }
});

/* --------------------------- track inspection (ffprobe) ---------------------- */
const LANG_NAMES = {
  hin: 'Hindi', hi: 'Hindi', urd: 'Urdu', ur: 'Urdu', eng: 'English', en: 'English',
  tur: 'Turkish', tr: 'Turkish', ara: 'Arabic', ar: 'Arabic', spa: 'Spanish', fre: 'French',
  fra: 'French', ger: 'German', deu: 'German', ita: 'Italian', rus: 'Russian', jpn: 'Japanese',
  kor: 'Korean', tam: 'Tamil', tel: 'Telugu', mal: 'Malayalam', kan: 'Kannada', ben: 'Bengali',
  pan: 'Punjabi', mar: 'Marathi', und: 'Unknown', mul: 'Multi',
};
const prettyLang = (code, title) => {
  const c = String(code || '').toLowerCase();
  if (LANG_NAMES[c]) return LANG_NAMES[c];
  const t = String(title || '').toLowerCase();
  for (const [k, v] of Object.entries(LANG_NAMES)) if (t.includes(v.toLowerCase())) return v;
  return code ? code.toUpperCase() : 'Track';
};

const probeCache = new Map();

app.get('/api/tracks/:ticket', async (req, res) => {
  const url = readTicket(req.params.ticket);
  if (!url) return res.status(410).json({ error: 'ticket expired' });
  if (!FFPROBE) return res.json({ ffprobe: false, audio: [], subs: [], duration: 0 });

  const key = req.params.ticket;
  const hit = probeCache.get(key);
  if (hit) return res.json(hit);

  const local = `${SELF()}/api/play/${key}`;   // probe through our own proxy (no TLS needed)
  const args = ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format',
    '-analyzeduration', '12M', '-probesize', '24M', local];

  const out = await new Promise((resolve) => {
    const ff = spawn(FFPROBE, args);
    let buf = '', err = '';
    const kill = setTimeout(() => ff.kill('SIGKILL'), 45_000);
    ff.stdout.on('data', (d) => { buf += d; });
    ff.stderr.on('data', (d) => { err += d; });
    ff.on('close', () => { clearTimeout(kill); try { resolve(JSON.parse(buf)); } catch { resolve(null); } });
    ff.on('error', () => { clearTimeout(kill); resolve(null); });
  });

  if (!out?.streams) return res.json({ ffprobe: true, audio: [], subs: [], duration: 0, failed: true });

  const audio = [], subs = [];
  let ai = 0, si = 0, video = null;
  for (const st of out.streams) {
    const tags = st.tags || {};
    if (st.codec_type === 'audio') {
      audio.push({
        id: ai, index: st.index, codec: st.codec_name, channels: st.channels,
        lang: prettyLang(tags.language, tags.title),
        raw: tags.language || '', title: tags.title || '',
        default: Boolean(st.disposition?.default),
      });
      ai++;
    } else if (st.codec_type === 'subtitle') {
      subs.push({
        id: si, index: st.index, codec: st.codec_name,
        lang: prettyLang(tags.language, tags.title),
        raw: tags.language || '', title: tags.title || '',
        forced: Boolean(st.disposition?.forced),
      });
      si++;
    } else if (st.codec_type === 'video' && !video) {
      video = { codec: st.codec_name, width: st.width, height: st.height };
    }
  }
  const payload = {
    ffprobe: true, audio, subs, video,
    duration: Number(out.format?.duration) || 0,
  };
  probeCache.set(key, payload);
  if (probeCache.size > 200) probeCache.delete(probeCache.keys().next().value);
  res.json(payload);
});

/* Compatibility + audio-switch layer. Video is copied (cheap) unless mode=full.
   `a` selects which audio stream to mux, `t` is the start offset in seconds —
   that is how seeking works while a converted stream is playing. */
app.get('/api/transcode/:ticket', (req, res) => {
  const ticketId = req.params.ticket;
  const url = readTicket(ticketId);
  if (!url) return res.status(410).end();
  if (!FFMPEG) return res.status(501).json({ error: 'ffmpeg is not installed on this server' });

  const start = Math.max(0, Number(req.query.t) || 0);
  const mode = req.query.mode === 'full' ? 'full' : 'remux';
  const a = req.query.a !== undefined && req.query.a !== '' ? Number(req.query.a) : 0;
  const local = `${SELF()}/api/play/${ticketId}`;

  const args = [
    '-hide_banner', '-loglevel', 'error',
    ...(start ? ['-ss', String(start)] : []),
    '-i', local,
    '-map', '0:v:0', '-map', `0:a:${Number.isFinite(a) ? a : 0}?`, '-sn', '-dn',
    ...(mode === 'full'
      ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-vf', 'scale=-2:min(720\\,ih)']
      : ['-c:v', 'copy']),
    '-c:a', 'aac', '-ac', '2', '-b:a', '192k',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof+faststart',
    '-f', 'mp4', 'pipe:1',
  ];
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-store');
  const ff = spawn(FFMPEG, args);
  ff.stdout.pipe(res);
  ff.stderr.on('data', (d) => console.error('[ffmpeg]', String(d).trim().slice(0, 200)));
  ff.on('error', () => res.destroy());
  const stop = () => ff.kill('SIGKILL');
  req.on('close', stop);
  res.on('close', stop);
});

/* Embedded subtitle track -> WebVTT (this is how Urdu/English subs baked into an
   MKV become selectable; sidecar .srt files keep working too). */
app.get('/api/subtrack/:ticket', (req, res) => {
  const ticketId = req.params.ticket;
  const url = readTicket(ticketId);
  if (!url) return res.status(410).end();
  if (!FFMPEG) return res.status(501).send('ffmpeg not installed');
  const s = Number(req.query.s) || 0;
  const local = `${SELF()}/api/play/${ticketId}`;
  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', local,
    '-map', `0:s:${s}`, '-c:s', 'webvtt', '-f', 'webvtt', 'pipe:1']);
  ff.stdout.pipe(res);
  ff.on('error', () => res.destroy());
  const stop = () => ff.kill('SIGKILL');
  req.on('close', stop);
  res.on('close', stop);
});

/* ------------------------------ static (prod) ------------------------------ */
const dist = path.join(__dirname, '..', 'dist');
app.use(express.static(dist));
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[samis] API on :${PORT}  tmdb=${Boolean(TMDB_KEY || TMDB_TOKEN)} torbox=${Boolean(TORBOX_KEY)}`);
});
