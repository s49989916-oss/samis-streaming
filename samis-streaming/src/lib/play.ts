/* One-call "just play it": pick the best source, push it into TorBox, wait for the
   cloud copy, pick the right file inside the pack, and hand a PlayRequest back. */
import { parseName, type CloudFile } from './api';
import { addToCloud, findSources, torrentStatus, type Source } from './catalog';
import type { PlayRequest } from '../components/Player';

export type Stage = { text: string; pct?: number };

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    if (signal?.aborted) return rej(new DOMException('aborted', 'AbortError'));
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); res(); }, ms);
    const onAbort = () => { clearTimeout(t); rej(new DOMException('aborted', 'AbortError')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** Thrown-and-swallowed marker so a cancelled open never shows an error. */
export const isAbort = (e: any) => e?.name === 'AbortError';

/** Choose the file inside a (possibly season-pack) torrent. */
export function pickFile(files: CloudFile[], want: { season?: number; episode?: number }) {
  const vids = files.filter((f) => f.isVideo && !/\b(sample|trailer)\b/i.test(f.path || f.name));
  if (!vids.length) return files.find((f) => f.isVideo) || null;
  if (want.episode !== undefined) {
    const hit = vids.find((f) => {
      const p = parseName(f.path || f.name);
      return p.episode === want.episode && (want.season === undefined || (p.season ?? want.season) === want.season);
    });
    if (hit) return hit;
  }
  return vids.sort((a, b) => (b.size || 0) - (a.size || 0))[0];
}

export async function resolvePlay(opts: {
  title: string;
  imdb?: string;
  year?: string;
  alt?: string[];
  season?: number;
  episode?: number;
  langs?: string[];
  dubbed?: boolean;
  poster?: string;
  backdrop?: string;
  subtitle?: string;
  keyPrefix: string;
  preferred?: Source;              // user picked a specific source
  onStage: (s: Stage) => void;
  signal?: AbortSignal;
}): Promise<PlayRequest> {
  const { signal } = opts;
  const stop = () => { if (signal?.aborted) throw new DOMException('aborted', 'AbortError'); };
  // Once cancelled, no further progress message can re-open the overlay.
  const onStage = (st: Stage) => { if (!signal?.aborted) opts.onStage(st); };
  stop();

  let source = opts.preferred;
  if (!source) {
    onStage({ text: 'Searching every source for the best instant copy…' });
    const { sources } = await findSources({
      imdb: opts.imdb, title: opts.title, year: opts.year, alt: opts.alt,
      season: opts.season, episode: opts.episode, langs: opts.langs, dubbed: opts.dubbed,
    });
    if (!sources.length) throw new Error('No source found for this title yet. Try another season/episode, or a different title spelling.');
    source = sources.find((s) => s.cached) || sources[0];
  }

  onStage({ text: source.cached ? 'Instant copy found — adding to your TorBox cloud…' : 'Adding to your TorBox cloud (not cached, this one downloads first)…' });
  const added = await addToCloud(source.hash, source.name);
  stop();

  // Fast path: a cached add already came back with its file list — no polling at all.
  let info: any = added.files?.length
    ? { id: added.id, cached: true, finished: true, progress: 1, files: added.files }
    : null;
  const deadline = Date.now() + (source.cached ? 60_000 : 20 * 60_000);
  let wait = 400;
  while (!info?.files?.length && Date.now() < deadline) {
    stop();
    info = await torrentStatus(added.id).catch(() => null);
    const ready = info && info.files?.length && (info.cached || info.finished || info.progress >= 1);
    if (ready) break;
    const pct = Math.round(((info?.progress ?? 0) as number) * 100);
    onStage({
      text: info?.files?.length
        ? `Preparing stream… ${pct}%`
        : 'TorBox is fetching the file list…',
      pct,
    });
    await sleep(wait, signal);
    wait = Math.min(2000, Math.round(wait * 1.4));   // snappy first, then relaxed
  }
  stop();
  if (!info?.files?.length) throw new Error('TorBox is still downloading this release. It will appear in My Cloud when ready.');

  const file = pickFile(info.files, { season: opts.season, episode: opts.episode });
  if (!file) throw new Error('That release contains no playable video file.');

  const subFiles = (info.files as CloudFile[]).filter((f) => f.isSub).map((f) => ({ file: f, item: info }));

  onStage({ text: 'Opening stream…', pct: 100 });
  return {
    key: `${opts.keyPrefix}${opts.season !== undefined ? `::s${opts.season}e${opts.episode}` : ''}`,
    title: opts.title,
    subtitle: opts.subtitle,
    poster: opts.poster,
    backdrop: opts.backdrop,
    kind: 'torrent',
    itemId: added.id,
    fileId: file.id,
    fileName: file.name,
    subFiles,
  };
}
