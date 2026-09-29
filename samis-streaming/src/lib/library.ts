/* Builds a Netflix-style library FROM THE USER'S TORBOX CLOUD.
   Every cloud item is parsed, matched against TMDB for art/metadata,
   grouped into series (season/episode) and categorised by language. */

import { CloudItem, CloudFile, TmdbItem, parseName, isSample, tmdb } from './api';

export type Episode = {
  season: number; episode: number;
  file: CloudFile; item: CloudItem;
  still?: string; name?: string; overview?: string;
};

export type Entry = {
  key: string;
  title: string;
  isSeries: boolean;
  langs: string[];
  language: 'tr' | 'hi' | 'en' | 'other';
  quality?: string;
  year?: string;
  tmdb?: TmdbItem | null;
  poster?: string;
  backdrop?: string;
  overview?: string;
  rating?: number;
  tmdbId?: number;
  tmdbType?: 'movie' | 'tv';
  episodes: Episode[];      // series
  files: { file: CloudFile; item: CloudItem }[]; // movie / loose files
  subs: { file: CloudFile; item: CloudItem }[];
  size: number;
  added: number;
  isExtra?: boolean;   // trailer / sample-only pack
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const searchCache = new Map<string, TmdbItem | null>();
async function findTmdb(query: string, isSeries: boolean, year?: string): Promise<TmdbItem | null> {
  const key = `${isSeries ? 'tv' : 'mv'}|${norm(query)}|${year || ''}`;
  if (searchCache.has(key)) return searchCache.get(key)!;
  let res: TmdbItem | null = null;
  try {
    const type = isSeries ? 'tv' : 'movie';
    const r: any = await tmdb(`search/${type}`, {
      query,
      include_adult: 'false',
      ...(year ? (isSeries ? { first_air_date_year: year } : { year }) : {}),
    });
    res = r?.results?.[0] || null;
    if (!res) {
      // Cross-type retry — filename guesses are not always right.
      const alt: any = await tmdb(`search/${isSeries ? 'movie' : 'tv'}`, { query, include_adult: 'false' });
      if (alt?.results?.[0]) { res = alt.results[0]; (res as any).media_type = isSeries ? 'movie' : 'tv'; }
    } else {
      (res as any).media_type = type;
    }
    if (!res) {
      const multi: any = await tmdb('search/multi', { query, include_adult: 'false' });
      res = (multi?.results || []).find((x: any) => x.media_type !== 'person') || null;
    }
  } catch { res = null; }
  searchCache.set(key, res);
  return res;
}

const langOf = (e: { langs: string[]; tmdb?: TmdbItem | null }): Entry['language'] => {
  const ol = e.tmdb?.original_language;
  if (ol === 'tr') return 'tr';
  if (ol === 'hi' || ol === 'ur' || ol === 'pa') return 'hi';
  if (ol === 'en') return 'en';
  if (e.langs.includes('Turkish')) return 'tr';
  if (e.langs.includes('Hindi') || e.langs.includes('Urdu')) return 'hi';
  if (e.langs.includes('English')) return 'en';
  return 'other';
};

/** Group cloud items + files into library entries (no network yet).
    Rules learned from real TorBox packs:
      - a pack with 2+ episode-marked videos is ONE series, titled from the pack name
      - sample/trailer files and non-video payloads are ignored
      - everything else is a movie (multiple source versions merge later by TMDB id) */
export function groupCloud(items: CloudItem[]): Entry[] {
  const map = new Map<string, Entry>();

  const ensure = (key: string, seed: Partial<Entry>): Entry => {
    let e = map.get(key);
    if (!e) {
      e = {
        key, title: '', isSeries: false, langs: [], language: 'other',
        episodes: [], files: [], subs: [], size: 0, added: 0, ...seed,
      } as Entry;
      map.set(key, e);
    }
    return e;
  };
  const push = (arr: string[], vals: string[]) => { for (const v of vals) if (!arr.includes(v)) arr.push(v); };
  const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

  for (const item of items) {
    if (item.hasVideo === false) continue; // games / .exe payloads never enter the library

    const added = item.createdAt ? new Date(item.createdAt).getTime() : 0;
    const subs = item.files.filter((f) => f.isSub).map((f) => ({ file: f, item }));
    const allVids = item.files.filter((f) => f.isVideo);
    const vids = allVids.filter((f) => !isSample(f.path || f.name));
    const extrasOnly = allVids.length > 0 && vids.length === 0;
    const big = vids.filter((f) => f.size > 80 * 1024 * 1024);
    const videos = big.length ? big : (vids.length ? vids : allVids);
    const pack = parseName(item.name);

    // ---- series pack -------------------------------------------------------
    const marked = videos.map((f) => ({ f, p: parseName(f.path || f.name) }));
    const epCount = marked.filter((m) => m.p.episode !== undefined).length;
    const isSeriesPack = videos.length > 1 && epCount >= 2;

    if (isSeriesPack || (pack.isSeries && pack.episode === undefined && videos.length > 1)) {
      const t = (pack.query.length >= 2 ? pack.query : marked[0].p.query)
        .replace(/\s+(?:19|20)\d{2}$/, '')   // "Money Heist 2021" -> "Money Heist"
        .trim();
      const key = `tv:${norm(t)}`;
      const e = ensure(key, { title: titleCase(t), isSeries: true });
      e.isSeries = true;
      e.quality = e.quality || pack.quality || marked[0]?.p.quality;
      e.added = Math.max(e.added, added);
      push(e.langs, pack.langs);
      let auto = 0;
      for (const { f, p } of marked) {
        push(e.langs, p.langs);
        const season = p.season ?? pack.season ?? 1;
        const episode = p.episode ?? ++auto;
        if (!e.episodes.some((x) => x.season === season && x.episode === episode)) {
          e.episodes.push({ season, episode, file: f, item });
        }
        e.size += f.size || 0;
      }
      e.subs.push(...subs);
      continue;
    }

    // ---- single files (movie, or a lone episode) ---------------------------
    const list: (CloudFile | null)[] = videos.length ? videos : [null];
    for (const f of list) {
      const p = f ? parseName(f.path || f.name) : pack;
      const useQ = (p.query.length >= 3 ? p.query : pack.query) || item.name;
      const single = p.episode !== undefined || pack.episode !== undefined;
      const year = p.year || pack.year;

      if (single) {
        const t = (pack.query.length >= 2 && videos.length === 1 ? pack.query : useQ)
          .replace(/\s+(?:19|20)\d{2}$/, '').trim();
        const key = `tv:${norm(t)}`;
        const e = ensure(key, { title: titleCase(t), isSeries: true });
        e.isSeries = true;
        e.added = Math.max(e.added, added);
        e.quality = e.quality || p.quality || pack.quality;
        push(e.langs, [...p.langs, ...pack.langs]);
        const season = p.season ?? pack.season ?? 1;
        const episode = (p.episode ?? pack.episode)!;
        if (!e.episodes.some((x) => x.season === season && x.episode === episode)) {
          e.episodes.push({ season, episode, file: f!, item });
          e.size += f?.size || 0;
        }
        e.subs.push(...subs);
      } else {
        const key = `mv:${norm(useQ)}${year ? ':' + year : ''}`;
        const e = ensure(key, { title: titleCase(useQ), isSeries: false, year, isExtra: extrasOnly });
        e.added = Math.max(e.added, added);
        e.quality = e.quality || p.quality || pack.quality;
        push(e.langs, [...p.langs, ...pack.langs]);
        e.files.push({
          file: f || ({ id: undefined as any, name: item.name, path: item.name, size: item.size, isVideo: true, isSub: false } as CloudFile),
          item,
        });
        e.size += f?.size || item.size || 0;
        e.subs.push(...subs);
      }
    }
  }

  const out = [...map.values()].filter((e) => e.episodes.length || e.files.length);
  out.forEach((e) => {
    e.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
    if (e.episodes.length) e.isSeries = true;
  });
  return out.sort((a, b) => b.added - a.added);
}

/** After TMDB matching, fold duplicate rips of the same title into one tile. */
export function mergeByTmdb(entries: Entry[]): Entry[] {
  const out: Entry[] = [];
  const byId = new Map<string, Entry>();
  for (const e of entries) {
    const id = e.tmdbId ? `${e.tmdbType}:${e.tmdbId}` : '';
    if (!id) { out.push(e); continue; }
    const prev = byId.get(id);
    if (!prev) { byId.set(id, e); out.push(e); continue; }
    // keep the richer entry, absorb the other's sources
    for (const f of e.files) if (!prev.files.some((x) => x.item.id === f.item.id && x.file?.id === f.file?.id)) prev.files.push(f);
    for (const ep of e.episodes) {
      if (!prev.episodes.some((x) => x.season === ep.season && x.episode === ep.episode)) prev.episodes.push(ep);
    }
    for (const s of e.subs) if (!prev.subs.some((x) => x.item.id === s.item.id && x.file.id === s.file.id)) prev.subs.push(s);
    for (const l of e.langs) if (!prev.langs.includes(l)) prev.langs.push(l);
    prev.size += e.size;
    prev.added = Math.max(prev.added, e.added);
    prev.isSeries = prev.isSeries || prev.episodes.length > 0;
    prev.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
  }
  return out.filter((e) => !e.tmdbId || byId.get(`${e.tmdbType}:${e.tmdbId}`) === e);
}

/** Enrich entries with TMDB metadata, in small concurrent batches. */
export async function enrich(entries: Entry[], onTick?: (done: number, total: number) => void) {
  let done = 0;
  const work = [...entries];
  const runner = async () => {
    while (work.length) {
      const e = work.shift()!;
      const m = await findTmdb(e.title, e.isSeries, e.year);
      if (m) {
        e.tmdb = m;
        e.tmdbId = m.id;
        e.tmdbType = (m as any).media_type === 'tv' || e.isSeries ? 'tv' : 'movie';
        e.title = m.title || m.name || e.title;
        e.poster = m.poster_path || undefined;
        e.backdrop = m.backdrop_path || undefined;
        e.overview = m.overview;
        e.rating = m.vote_average;
        e.year = e.year || (m.release_date || m.first_air_date || '').slice(0, 4);
      }
      e.language = langOf(e);
      done++; onTick?.(done, entries.length);
    }
  };
  await Promise.all(Array.from({ length: 5 }, runner));
  return entries;
}

/** Pull episode names/stills from TMDB for a series entry. */
export async function hydrateEpisodes(e: Entry) {
  if (!e.tmdbId || e.tmdbType !== 'tv') return e;
  const seasons = [...new Set(e.episodes.map((x) => x.season))];
  await Promise.all(seasons.map(async (s) => {
    try {
      const data: any = await tmdb(`tv/${e.tmdbId}/season/${s}`);
      for (const ep of e.episodes.filter((x) => x.season === s)) {
        const m = (data.episodes || []).find((x: any) => x.episode_number === ep.episode);
        if (m) { ep.name = m.name; ep.overview = m.overview; ep.still = m.still_path; }
      }
    } catch { /* season not on TMDB — keep raw numbering */ }
  }));
  return e;
}
