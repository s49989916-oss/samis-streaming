/* TMDB catalogue: browse EVERYTHING (not just the cloud), by language + genre. */
import { tmdb, type TmdbItem } from './api';

export type Lang = 'tr' | 'hi' | 'en' | 'dub';
export type Kind = 'movie' | 'tv';

export const LANGS: { id: Lang; label: string; note: string }[] = [
  { id: 'tr', label: 'Turkish', note: 'Türk dizileri & filmleri' },
  { id: 'hi', label: 'Hindi', note: 'Bollywood & Indian' },
  { id: 'en', label: 'English', note: 'Hollywood' },
  { id: 'dub', label: 'English Dubbed', note: 'foreign titles, dual-audio sources' },
];

/** Genres are fetched once per kind and cached. */
const genreCache: Record<string, { id: number; name: string }[]> = {};
export async function genres(kind: Kind) {
  if (genreCache[kind]) return genreCache[kind];
  const r: any = await tmdb(`genre/${kind}/list`);
  genreCache[kind] = r?.genres || [];
  return genreCache[kind];
}

export type BrowseOpts = {
  kind: Kind; lang: Lang; genre?: number; page?: number; sort?: string; query?: string;
};

export async function browse({ kind, lang, genre, page = 1, sort = 'popularity.desc', query }: BrowseOpts) {
  if (query) {
    const r: any = await tmdb(`search/${kind}`, { query, page, include_adult: 'false' });
    return { results: (r?.results || []) as TmdbItem[], total: r?.total_pages || 1 };
  }
  const params: Record<string, any> = {
    page, sort_by: sort, include_adult: 'false', 'vote_count.gte': sort.startsWith('vote') ? 200 : 20,
  };
  if (genre) params.with_genres = genre;
  if (lang === 'dub') params.with_original_language = 'tr|hi|ko|ja|es';
  else params.with_original_language = lang;
  const r: any = await tmdb(`discover/${kind}`, params);
  return { results: (r?.results || []) as TmdbItem[], total: r?.total_pages || 1 };
}

export type Details = {
  id: number; kind: Kind; title: string; overview: string; poster?: string; backdrop?: string;
  year?: string; rating?: number; genres: string[]; imdb?: string; runtime?: number;
  originalTitle?: string; altTitles: string[]; seasons: { season_number: number; episode_count: number; name: string }[];
  cast: { id: number; name: string; character: string; profile_path?: string }[];
  trailer?: string; language?: string;
};

export async function details(kind: Kind, id: number): Promise<Details> {
  const d: any = await tmdb(`${kind}/${id}`, {
    append_to_response: 'external_ids,credits,videos,alternative_titles,images',
  });
  const alt = kind === 'movie' ? d.alternative_titles?.titles : d.alternative_titles?.results;
  const yt = (d.videos?.results || []).find((v: any) => v.site === 'YouTube' && /trailer|teaser/i.test(v.type));
  return {
    id: d.id, kind,
    title: d.title || d.name,
    originalTitle: d.original_title || d.original_name,
    altTitles: [...new Set<string>((alt || []).map((a: any) => a.title).filter(Boolean))].slice(0, 6),
    overview: d.overview,
    poster: d.poster_path, backdrop: d.backdrop_path,
    year: (d.release_date || d.first_air_date || '').slice(0, 4),
    rating: d.vote_average, runtime: d.runtime || d.episode_run_time?.[0],
    genres: (d.genres || []).map((g: any) => g.name),
    imdb: d.external_ids?.imdb_id || undefined,
    language: d.original_language,
    seasons: (d.seasons || []).filter((s: any) => s.season_number > 0),
    cast: (d.credits?.cast || []).slice(0, 14),
    trailer: yt?.key,
  };
}

export const season = (id: number, n: number) => tmdb<any>(`tv/${id}/season/${n}`);

/* --------------------------- source + auto-add API --------------------------- */
export type Source = {
  name: string; hash: string; size: number; seeders: number; cached?: boolean; owned?: boolean;
  quality?: string; codec?: string; audio: string[]; score: number; compat: 'direct' | 'convert';
  files?: { id: number; name: string; path: string; size: number }[];
};

export async function findSources(o: {
  imdb?: string; title: string; year?: string; season?: number; episode?: number;
  langs?: string[]; dubbed?: boolean; alt?: string[];
}) {
  const p = new URLSearchParams();
  if (o.imdb) p.set('imdb', o.imdb);
  p.set('title', o.title);
  if (o.year) p.set('year', o.year);
  if (o.season !== undefined) p.set('season', String(o.season));
  if (o.episode !== undefined) p.set('episode', String(o.episode));
  if (o.langs?.length) p.set('langs', o.langs.join(','));
  if (o.dubbed) p.set('dubbed', '1');
  if (o.alt?.length) p.set('alt', o.alt.join('|'));
  const r = await fetch(`/api/sources?${p}`);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Source search failed');
  return (await r.json()) as { sources: Source[]; instant: number };
}

export async function addToCloud(hash: string, name: string) {
  const r = await fetch('/api/add', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hash, name }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'TorBox refused this torrent');
  return j as { id: number; hash: string; cached: boolean; detail: string; files?: import('./api').CloudFile[] };
}

export const torrentStatus = (id: number) => fetch(`/api/torrent/${id}`).then((r) => r.json());
