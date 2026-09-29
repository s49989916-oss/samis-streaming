/* Client API layer — talks only to our own server, never to TMDB/TorBox directly.
   Keys therefore never exist in the browser bundle. */

export const IMG = (p?: string | null, size = 'w500') =>
  p ? `https://image.tmdb.org/t/p/${size}${p}` : '';

async function j<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const text = await r.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 200) }; }
  if (!r.ok) throw new Error(body?.error || body?.detail || `Request failed (${r.status})`);
  return body as T;
}

export const tmdb = <T = any>(path: string, params: Record<string, any> = {}) => {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '') as any
  ).toString();
  return j<T>(`/api/tmdb/${path}${qs ? `?${qs}` : ''}`);
};

export type TmdbItem = {
  id: number; title?: string; name?: string; poster_path?: string; backdrop_path?: string;
  overview?: string; vote_average?: number; release_date?: string; first_air_date?: string;
  original_language?: string; media_type?: 'movie' | 'tv';
};

export type CloudFile = {
  id: number; name: string; path: string; size: number; mime?: string; isVideo: boolean; isSub: boolean;
};
export type CloudItem = {
  kind: 'torrent' | 'usenet' | 'webdl';
  id: number; name: string; hash?: string; size: number; createdAt?: string;
  cached: boolean; finished: boolean; progress: number; files: CloudFile[]; hasVideo?: boolean;
};

/** Rough browser-playability guess used for the compatibility badge. */
export const playability = (name = ''): 'good' | 'risky' | 'bad' => {
  const n = name.toLowerCase();
  if (/\.(exe|bin|iso|rar|zip|msi)$/.test(n)) return 'bad';
  const hevc = /(x265|h\.?265|hevc)/.test(n);
  const hardAudio = /(dts|truehd|flac|ac3|dd5|ddp|atmos|eac3)/.test(n);
  if (/\.(mp4|m4v|webm)$/.test(n) && !hardAudio) return 'good';
  if (hevc || hardAudio || /\.(avi|wmv|mpg|ts|m2ts)$/.test(n)) return 'risky';
  return 'good';
};
export type CloudResponse = { items: CloudItem[]; errors: string[]; counts: Record<string, number> };

export const getCloud = () => j<CloudResponse>('/api/cloud');
export const getStreamUrl = (kind: string, id: number, fileId?: number) =>
  j<{ url: string; ticket?: string }>(`/api/stream?kind=${kind}&id=${id}${fileId !== undefined ? `&fileId=${fileId}` : ''}`);
export const getHealth = () => j<{ tmdb: boolean; torbox: boolean }>('/api/health');

export const title = (i: TmdbItem) => i.title || i.name || 'Untitled';
export const year = (i: TmdbItem) => (i.release_date || i.first_air_date || '').slice(0, 4);
export const fmtSize = (b = 0) => {
  if (!b) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i < 2 ? 0 : 1)} ${u[i]}`;
};
export const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};

/* ------------------- filename parsing for cloud -> TMDB match ------------------- */
const JUNK = /\b(1080p|2160p|720p|480p|4k|uhd|hdr10?|sdr|dv|ds4k|imax|x264|x265|h ?264|h ?265|avc|hevc|aac|ac3|dts|truehd|atmos|ddp?\+?5[\. ]?1|dd\+|eac3|flac|opus|web[- ]?dl|webmux|webrip|web|bluray|blu[- ]?ray|bdrip|bdremux|remux|brrip|hdrip|hq|dvdrip|amzn|nf|atvp|ma|hotstar|zee5|sonyliv|netflix|hulu|disney|multi|dual|audio|esubs?|msubs?|hin|eng|tam|tel|mal|kan|urd|tur|ita|fre|ger|por|spa|rus|ukr|dubbed|org|proper|repack|10bit|8bit|complete|season|part|pre|rip|encoded|by)\b/gi;
// Release-site prefixes: "www.1TamilMV.team - ", "www 5MovieRulz camp - ", "[EZTV] " ...
const TRACKER = /^\s*(?:\[[^\]]*\]\s*)*(?:www[\s.][^-–]*[-–]\s*|(?:1tamilmv|1tamilblasters|5movierulz|tamilblasters|movierulz|tamilmv|torrenting|uindex|ext\.to|eztv|ziromb|qrips)[^\s\]]*\s*[-–]?\s*)+/i;

export const isSample = (name: string) =>
  /\b(sample|trailer|tlr|teaser|featurette|extras?|behind[ ]the[ ]scenes)\b/i
    .test(name.replace(/^.*[\\/]/, '').replace(/[._]+/g, ' '));

export function parseName(raw: string) {
  const file = raw.replace(/^.*[\\/]/, '');
  const base = file.replace(/\.[a-z0-9]{2,4}$/i, '');
  let spaced = base.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  spaced = spaced.replace(TRACKER, '').replace(/^[\s\-–|]+/, '');

  // season / episode, in every layout these packs actually use
  const pats: RegExp[] = [
    /\bS(\d{1,2})\s*[.\-_ ]?\s*E(?:p)?(\d{1,3})\b/i,          // S05E01 / s01.e06
    /\b(\d{1,2})x(\d{1,3})\b/i,                                // 4x01
    /\[?\s*P(\d{1,2})[.\- ]?Ep(\d{1,3})\s*\]?/i,               // [P4.Ep1]
    /\bSeason\s*(\d{1,2}).{0,12}?Episode\s*(\d{1,3})\b/i,
  ];
  let se: RegExpMatchArray | null = null;
  for (const re of pats) { const m = spaced.match(re); if (m) { se = m; break; } }
  const epOnly = !se && (spaced.match(/\bE(?:p(?:isode)?)?\s*[.\- ]?\s*(\d{1,3})\b/i)
    || spaced.match(/\b(?:Bolum|Bölüm)\s*(\d{1,3})\b/i));
  const seasonOnly = spaced.match(/\bS(?:eason)?\s*[.\- ]?\s*(\d{1,2})\b/i);
  const ym = spaced.match(/\b(19|20)\d{2}\b/);

  let name = spaced;
  // A season marker always ends the title ("Reacher S01 ...", "Money Heist Season 04 ...")
  const seasonCut = spaced.match(/\b(?:S\s?\d{1,2}\b|Season\s*\d{1,2}\b)/i);
  const cut0 = seasonCut?.index;
  const cut = cut0 !== undefined && cut0 > 2 ? cut0 : se?.index ?? (epOnly ? epOnly.index : undefined) ?? (ym ? ym.index : undefined);
  if (cut !== undefined && cut > 2) name = spaced.slice(0, cut);
  name = name
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(JUNK, ' ')
    .replace(/[-–—_|]+/g, ' ')
    .replace(/[([{)\]}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // trailing codec/number residue: "Money Heist 04 DD 5 1", "Reacher DDP SGF"
    // trailing release residue only (must start with a junk word, then any numbers)
    .replace(/\s+(?:dd|ddp|sgf|com|net|org|www|hd|fhd|uhd|x\d+|\d+ ?bit)(?:\s+\d{1,3})*$/i, '')
    .replace(/\s+(?:hindi|urdu|english|turkish|tamil|telugu|malayalam|kannada|multi|dual)$/i, '')
    .replace(/[\s.\-:]+$/, '');
  if (name.length < 2) name = spaced.replace(JUNK, ' ').replace(/\s+/g, ' ').trim();

  const low = spaced.toLowerCase();
  const langs: string[] = [];
  if (/\b(hin|hindi)\b/.test(low)) langs.push('Hindi');
  if (/\b(urd|urdu)\b/.test(low)) langs.push('Urdu');
  if (/\b(eng|english)\b/.test(low)) langs.push('English');
  if (/\b(tur|turkish|turkce)\b/.test(low)) langs.push('Turkish');
  if (/\b(dual|multi)\b/.test(low) && langs.length < 2) langs.push('Multi');

  return {
    query: name,
    season: se ? Number(se[1]) : seasonOnly ? Number(seasonOnly[1]) : undefined,
    episode: se ? Number(se[2]) : epOnly ? Number(epOnly[1]) : undefined,
    year: ym ? ym[0] : undefined,
    isSeries: Boolean(se || epOnly || seasonOnly),
    langs,
    quality: ((low.match(/\b(2160p|4k|1080p|720p|480p)\b/) || [])[0] || '').toUpperCase() || undefined,
  };
}

/* --------------------------------- watch store -------------------------------- */
export type Progress = {
  key: string; title: string; poster?: string; backdrop?: string;
  kind: string; itemId: number; fileId?: number; fileName?: string;
  time: number; duration: number; updated: number; sub?: string;
};
const PKEY = 'samis.progress.v1';
export const loadProgress = (): Progress[] => {
  try { return JSON.parse(localStorage.getItem(PKEY) || '[]'); } catch { return []; }
};
export const saveProgress = (p: Progress) => {
  const all = loadProgress().filter((x) => x.key !== p.key);
  all.unshift(p);
  localStorage.setItem(PKEY, JSON.stringify(all.slice(0, 40)));
};
export const getProgressFor = (key: string) => loadProgress().find((x) => x.key === key);
export const removeProgress = (key: string) => {
  localStorage.setItem(PKEY, JSON.stringify(loadProgress().filter((x) => x.key !== key)));
};
