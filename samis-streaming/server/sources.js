/**
 * Source discovery: find torrents for ANY title (not just what is already in the
 * cloud), rank them for instant + browser-friendly playback, and hand the winner
 * to TorBox so it lands in the user's cloud automatically.
 */

const UA = { 'User-Agent': 'Mozilla/5.0 (Sami\'s Streaming)' };

const timed = async (url, opts = {}, ms = 15000) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal, headers: { ...UA, ...(opts.headers || {}) } }); }
  finally { clearTimeout(t); }
};

/* ------------------------------- indexers -------------------------------- */

/** The Pirate Bay public API — keyless, IMDb-aware, huge catalogue. */
async function apibay({ imdb, query }) {
  const q = (imdb || query || '').trim();
  if (q.length < 3) return [];        // a short/empty query makes TPB return "latest", not matches
  try {
    const r = await timed(`https://apibay.org/q.php?q=${encodeURIComponent(q)}`);
    const list = await r.json();
    if (!Array.isArray(list)) return [];
    return list
      .filter((x) => x.info_hash && x.info_hash !== '0000000000000000000000000000000000000000'
        && !/^no results returned$/i.test(x.name || ''))
      .map((x) => ({
        name: x.name,
        hash: String(x.info_hash).toLowerCase(),
        size: Number(x.size) || 0,
        seeders: Number(x.seeders) || 0,
        leechers: Number(x.leechers) || 0,
        imdb: x.imdb || null,
        source: 'tpb',
      }));
  } catch { return []; }
}

/** Knaben meta-indexer: aggregates 30+ trackers (good Turkish/Hindi coverage). */
async function knaben({ query }) {
  if (!query || query.length < 3) return [];
  try {
    const r = await timed('https://api.knaben.eu/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        search_type: 'score', search_field: 'title', query,
        order_by: 'seeders', order_direction: 'desc', size: 40, hide_unsafe: true,
      }),
    }, 9000);
    if (!r.ok) return [];
    const j = await r.json();
    return (j?.hits || []).map((x) => ({
      name: x.title,
      hash: String(x.hash || '').toLowerCase(),
      size: Number(x.bytes) || 0,
      seeders: Number(x.seeders) || 0,
      leechers: Number(x.peers) || 0,
      source: 'knaben',
    })).filter((x) => /^[a-f0-9]{40}$/.test(x.hash));
  } catch { return []; }
}

/** BitSearch: simple HTML, magnet links inline. Secondary fallback. */
async function bitsearch({ query }) {
  if (!query || query.length < 3) return [];
  try {
    const r = await timed(`https://bitsearch.to/search?q=${encodeURIComponent(query)}&sort=seeders`, {}, 9000);
    if (!r.ok) return [];
    const html = await r.text();
    const out = [];
    const re = /<li class="card search-result[\s\S]*?<\/li>/g;
    for (const block of html.match(re) || []) {
      const hash = (block.match(/btih:([a-fA-F0-9]{40})/) || [])[1];
      const name = (block.match(/<h5[^>]*>\s*<a[^>]*>([^<]+)</) || [])[1];
      const seeds = (block.match(/data-seeders="(\d+)"/) || block.match(/<font color="green">(\d+)<\/font>/) || [])[1];
      if (hash && name) out.push({ name: name.trim(), hash: hash.toLowerCase(), size: 0, seeders: Number(seeds) || 0, leechers: 0, source: 'bitsearch' });
    }
    return out;
  } catch { return []; }
}

/** TorBox's own search API (available on normal networks; skipped if unreachable). */
async function torboxSearch({ imdb, season, episode, apiKey }) {
  if (!imdb) return [];
  try {
    const qs = new URLSearchParams({ metadata: 'false', check_cache: 'true', check_owned: 'true' });
    if (season !== undefined) qs.set('season', String(season));
    if (episode !== undefined) qs.set('episode', String(episode));
    const r = await timed(
      `https://search-api.torbox.app/torrents/${imdb}?${qs}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
      12000
    );
    if (!r.ok) return [];
    const j = await r.json();
    const list = j?.data?.torrents || j?.torrents || (Array.isArray(j?.data) ? j.data : []) || j?.items || [];
    return list.map((x) => ({
      name: x.raw_title || x.title || x.name,
      hash: String(x.hash || x.info_hash || '').toLowerCase(),
      size: Number(x.size) || 0,
      seeders: Number(x.last_known_seeders ?? x.seeders) || 0,
      leechers: Number(x.last_known_peers ?? x.leechers) || 0,
      cached: Boolean(x.cached),
      owned: Boolean(x.owned),
      source: 'torbox',
    })).filter((x) => x.hash);
  } catch { return []; }
}

/* -------------------------------- ranking -------------------------------- */

const has = (n, re) => re.test(n);

export function scoreSource(s, want = {}) {
  const n = (s.name || '').toLowerCase();
  let score = 0;

  // 1. instant playback beats everything
  if (s.cached) score += 1000;
  if (s.owned) score += 300;

  // 2. browser-decodable first: H.264 + AAC in MP4/MKV plays everywhere
  const hevc = has(n, /(x[ .]?265|h[ .]?265|hevc|av1)/);
  const h264 = has(n, /(x[ .]?264|h[ .]?264|avc)/);
  const hardAudio = has(n, /(dts|truehd|flac|atmos)/);
  const ac3 = has(n, /(ac3|eac3|dd ?5|ddp)/);
  if (h264) score += 220;
  if (hevc) score -= 160;
  if (hardAudio) score -= 140;
  if (ac3) score -= 40;
  if (has(n, /\baac\b/)) score += 90;
  if (has(n, /\.mp4|\bmp4\b/)) score += 70;
  if (has(n, /remux/)) score -= 200;         // huge, usually DTS-HD
  if (has(n, /\b(cam|hdcam|ts|telesync|hdts|predvd)\b/)) score -= 900; // junk rips

  // 3. resolution sweet spot
  if (has(n, /1080p/)) score += 130;
  else if (has(n, /720p/)) score += 60;
  else if (has(n, /(2160p|4k|uhd)/)) score -= 40;
  else if (has(n, /(480p|360p)/)) score -= 60;

  // 4. size sanity (per episode/movie)
  const gb = s.size / 1e9;
  if (gb > 0) {
    if (want.episode !== undefined) score += gb > 0.4 && gb < 4 ? 60 : -60;
    else score += gb > 0.8 && gb < 6 ? 60 : gb > 12 ? -120 : -20;
  }

  // 5. language wishes
  if (want.langs?.length) {
    for (const l of want.langs) {
      const re = {
        hindi: /\b(hindi|hin)\b/, urdu: /\b(urdu|urd)\b/, english: /\b(english|eng)\b/,
        turkish: /\b(turkish|tur|turkce)\b/, dual: /\b(dual|multi)\b/,
      }[l.toLowerCase()];
      if (re && has(n, re)) score += 160;
    }
  }
  if (want.dubbed && has(n, /\b(dual|multi|dubbed|dub)\b/)) score += 200;
  if (want.esub && has(n, /\b(esubs?|msubs?|subs?)\b/)) score += 60;

  // 6. health
  score += Math.min(300, Math.sqrt(Math.max(0, s.seeders)) * 22);
  if (s.seeders === 0 && !s.cached) score -= 400;

  return Math.round(score);
}

/** Dedupe + rank + annotate. */
export function rankSources(list, want) {
  const byHash = new Map();
  for (const s of list) {
    if (!s.hash) continue;
    const prev = byHash.get(s.hash);
    if (prev) {
      prev.seeders = Math.max(prev.seeders, s.seeders);
      prev.cached = prev.cached || s.cached;
      prev.owned = prev.owned || s.owned;
      prev.size = prev.size || s.size;
      continue;
    }
    byHash.set(s.hash, { ...s });
  }
  const out = [...byHash.values()];
  for (const s of out) {
    const n = (s.name || '').toLowerCase();
    s.quality = (n.match(/\b(2160p|4k|1080p|720p|480p)\b/) || [])[0]?.toUpperCase();
    s.codec = /x[ .]?265|h[ .]?265|hevc/.test(n) ? 'HEVC' : /av1/.test(n) ? 'AV1' : 'H.264';
    s.audio = [
      /\b(hindi|hin)\b/.test(n) && 'Hindi',
      /\b(urdu|urd)\b/.test(n) && 'Urdu',
      /\b(turkish|tur)\b/.test(n) && 'Turkish',
      /\b(english|eng)\b/.test(n) && 'English',
      /\b(dual|multi)\b/.test(n) && 'Dual',
    ].filter(Boolean);
    s.score = scoreSource(s, want);
    // how likely the browser plays it with no conversion
    s.compat = /x[ .]?265|h[ .]?265|hevc|av1/.test(n) || /dts|truehd|flac/.test(n) ? 'convert' : 'direct';
  }
  return out.sort((a, b) => b.score - a.score);
}

const STOP = new Set(['the', 'a', 'an', 'of', 'and', '&']);
const toks = (s) => String(s || '')
  .toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ')
  .split(' ').filter((t) => t && !STOP.has(t));

/** Reject spin-offs / unrelated hits: the release title must BE the wanted title,
    not merely contain it ("The Walking Dead" must not match "Fear the Walking Dead"). */
export function titleMatches(releaseName, title, { season, episode, year } = {}) {
  const want = toks(title);
  if (want.length < 1) return false;   // never match on an empty/unknown title
  let head = String(releaseName || '').replace(/^\s*(?:\[[^\]]*\]|www[^\s]*\s*-)\s*/i, '');
  const cut = head.search(/\b(s\d{1,2}[\s._-]?e?\d{0,3}|season[\s._-]?\d{1,2}|\d{1,2}x\d{1,3}|(?:19|20)\d{2}|1080p|720p|2160p|480p)\b/i);
  if (cut > 2) head = head.slice(0, cut);
  const got = toks(head);
  if (!got.length) return false;
  // every wanted token present, and no more than 2 extra leading words
  const missing = want.filter((t) => !got.includes(t));
  if (missing.length) return false;
  if (got.join(' ') === want.join(' ')) return true;
  // extras are only tolerated for movie editions, never for series
  const EDITION = /^(extended|uncut|unrated|remastered|directors|director|cut|imax|theatrical|special|edition|final|3d|hq|open|matte|redux|ultimate|complete|dual|hindi|english|turkish|urdu|multi)$/;
  if (season !== undefined || episode !== undefined) return false;
  const extra = got.filter((t) => !want.includes(t));
  return extra.length <= 2 && extra.every((t) => EDITION.test(t));
}

/** Torrentio (Stremio addon). Excellent for Turkish/Hindi/Indian releases and
    already IMDb-keyed, so no title guessing. Some datacentre IPs get a
    Cloudflare 403 — that simply yields zero results and never blocks a search. */
async function torrentio({ imdb, season, episode }) {
  if (!imdb) return [];
  const type = season !== undefined ? 'series' : 'movie';
  const id = season !== undefined ? `${imdb}:${season}:${episode ?? 1}` : imdb;
  const url = `https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,rutor,rutracker,comando,bludv,torrent9,ilcorsaronero,mejortorrent,wolfmax4k,cinecalidad/sort=seeders/stream/${type}/${encodeURIComponent(id)}.json`;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 9000);
    const r = await fetch(url, { signal: ctl.signal, headers: { ...UA, Accept: 'application/json' } });
    clearTimeout(t);
    if (!r.ok) return [];
    const j = await r.json();
    return (j.streams || []).map((st) => {
      const lines = String(st.title || st.name || '').split('\n');
      const name = (st.behaviorHints?.filename || lines[0] || '').trim();
      const meta = lines.join(' ');
      const seeds = Number((meta.match(/👤\s*(\d+)/) || [])[1] || 0);
      const sizeTxt = (meta.match(/💾\s*([\d.]+)\s*(GB|MB)/i) || []);
      const size = sizeTxt[1] ? Number(sizeTxt[1]) * (/gb/i.test(sizeTxt[2]) ? 1e9 : 1e6) : 0;
      return { name: name || meta.slice(0, 120), hash: String(st.infoHash || '').toLowerCase(), seeds, size, source: 'torrentio' };
    }).filter((x) => /^[a-f0-9]{40}$/.test(x.hash));
  } catch { return []; }
}

/** Query every indexer we can reach, in parallel. */
const deAccent = (s) => String(s || '')
  .replace(/[ışğüöçİŞĞÜÖÇı]/g, (c) => ({ 'ı': 'i', 'ş': 's', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c', 'İ': 'I', 'Ş': 'S', 'Ğ': 'G', 'Ü': 'U', 'Ö': 'O', 'Ç': 'C' }[c] || c))
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export async function findSources({ imdb, title, year, season, episode, apiKey, altTitles = [], want }) {
  const queries = [];
  if (imdb) queries.push(apibay({ imdb }));
  if (imdb) queries.push(torrentio({ imdb, season, episode }));
  const names = [...new Set([title, deAccent(title), ...altTitles, ...altTitles.map(deAccent)]
    .map((x) => String(x || '').trim())
    .filter((x) => x.length >= 3))].slice(0, 4);
  if (!names.length && !imdb) return [];
  for (const title of names) {
    const base = season !== undefined && episode !== undefined
      ? `${title} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
      : season !== undefined
        ? `${title} S${String(season).padStart(2, '0')}`
        : `${title}${year ? ' ' + year : ''}`;
    queries.push(apibay({ query: base }));
    queries.push(knaben({ query: base }));
    queries.push(bitsearch({ query: base }));
    if (want?.langs?.includes('hindi')) queries.push(apibay({ query: `${base} hindi` }));
    if (want?.langs?.includes('turkish')) queries.push(apibay({ query: `${base} turkish` }));
  }
  queries.push(torboxSearch({ imdb, season, episode, apiKey }));

  const settled = await Promise.allSettled(queries);
  const results = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

  // keep only plausible matches for the requested title + episode
  const filtered = results.filter((s) => {
    const n = (s.name || '').toLowerCase();
    if (!names.some((t) => titleMatches(s.name, t, { season, episode, year }))
        && !names.some((t) => titleMatches(deAccent(s.name), deAccent(t), { season, episode, year }))) return false;
    if (year && season === undefined) {
      const ys = (s.name || '').match(/\b(19|20)\d{2}\b/);
      if (ys && Math.abs(Number(ys[0]) - Number(year)) > 1) return false;
    }
    if (episode !== undefined && season !== undefined) {
      const se = new RegExp(`s0?${season}[\\s._-]?e0?${episode}\\b|${season}x0?${episode}\\b`, 'i');
      const seasonPack = new RegExp(`(s0?${season}\\b|season[\\s._-]?0?${season}\\b)`, 'i');
      return se.test(n) || seasonPack.test(n) || /complete/.test(n);
    }
    return true;
  });
  return rankSources(filtered, { ...want, season, episode });
}
