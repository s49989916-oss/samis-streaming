import { useEffect, useMemo, useState } from 'react';
import { IMG, fmtSize, tmdb } from '../lib/api';
import { hydrateEpisodes, type Entry } from '../lib/library';
import type { PlayRequest } from '../components/Player';
import { focusFirst } from '../lib/spatial';
import { IPlay } from '../components/Icons';

export default function Detail({
  entry, onBack, onPlay,
}: { entry: Entry; onBack: () => void; onPlay: (p: PlayRequest) => void }) {
  const [, force] = useState(0);
  const [season, setSeason] = useState<number>(entry.episodes[0]?.season ?? 1);
  const [cast, setCast] = useState<any[]>([]);
  const [trailer, setTrailer] = useState<string | null>(null);
  const [showTrailer, setShowTrailer] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      if (entry.isSeries) { await hydrateEpisodes(entry); if (!dead) force((n) => n + 1); }
      if (entry.tmdbId) {
        try {
          const t = entry.tmdbType || (entry.isSeries ? 'tv' : 'movie');
          const [c, v]: any = await Promise.all([
            tmdb(`${t}/${entry.tmdbId}/credits`),
            tmdb(`${t}/${entry.tmdbId}/videos`),
          ]);
          if (dead) return;
          setCast((c?.cast || []).slice(0, 12));
          const yt = (v?.results || []).find((x: any) => x.site === 'YouTube' && /trailer|teaser/i.test(x.type));
          setTrailer(yt?.key || null);
        } catch { /* metadata is optional */ }
      }
    })();
    const t = setTimeout(() => setShowTrailer(true), 3000);
    setTimeout(() => focusFirst(), 200);
    return () => { dead = true; clearTimeout(t); };
  }, [entry.key]);

  const seasons = useMemo(() => [...new Set(entry.episodes.map((e) => e.season))].sort((a, b) => a - b), [entry.episodes, entry.episodes.length]);
  const eps = entry.episodes.filter((e) => e.season === season);

  const playEpisode = (i: number) => {
    const ep = eps[i];
    if (!ep) return;
    onPlay({
      key: `${entry.key}::s${ep.season}e${ep.episode}`,
      title: entry.title,
      subtitle: `S${ep.season} E${ep.episode}${ep.name ? ' · ' + ep.name : ''}`,
      poster: entry.poster, backdrop: entry.backdrop,
      kind: ep.item.kind, itemId: ep.item.id, fileId: ep.file.id,
      fileName: ep.file.name,
      subFiles: entry.subs,
      onNext: i + 1 < eps.length ? () => playEpisode(i + 1) : undefined,
    });
  };

  const playMovie = (idx = 0) => {
    const f = entry.files[idx];
    if (!f) return;
    onPlay({
      key: entry.key, title: entry.title, subtitle: entry.year,
      poster: entry.poster, backdrop: entry.backdrop,
      kind: f.item.kind, itemId: f.item.id, fileId: f.file?.id,
      fileName: f.file?.name, subFiles: entry.subs,
    });
  };

  return (
    <div className="detail">
      <div className="detail-hero">
        {showTrailer && trailer ? (
          <div className="hero-media">
            <iframe
              title="trailer"
              src={`https://www.youtube.com/embed/${trailer}?autoplay=1&mute=1&controls=0&loop=1&playlist=${trailer}&modestbranding=1&rel=0`}
              allow="autoplay; encrypted-media" />
          </div>
        ) : (
          <div className="hero-media">
            {entry.backdrop
              ? <img src={IMG(entry.backdrop, 'original')} alt="" className="gpu" />
              : <div className="skel" style={{ width: '100%', height: '100%' }} />}
          </div>
        )}
        <div className="hero-fade" />
        <div className="hero-body fadein">
          <div className="meta">
            {entry.year && <span className="tag">{entry.year}</span>}
            {entry.rating ? <span className="tag gold">★ {entry.rating.toFixed(1)}</span> : null}
            {entry.quality && <span className="tag">{entry.quality}</span>}
            <span className="tag">{entry.isSeries ? `${entry.episodes.length} EPISODES` : 'MOVIE'}</span>
            {entry.langs.map((l) => <span className="tag gold" key={l}>{l}</span>)}
            {entry.subs.length ? <span className="tag">CC × {entry.subs.length}</span> : null}
          </div>
          <h1>{entry.title}</h1>
          <p>{entry.overview || 'No synopsis available — streaming straight from your TorBox cloud.'}</p>
          <div className="row-btns">
            <button className="btn btn-primary" data-focus data-focus-default="true"
              onClick={() => (entry.isSeries ? playEpisode(0) : playMovie(0))}>
              <IPlay size={16} /> {entry.isSeries ? `Play S${season} E${eps[0]?.episode ?? 1}` : 'Play'}
            </button>
            <button className="btn btn-ghost" data-focus onClick={onBack}>← Back</button>
          </div>
        </div>
      </div>

      <div className="detail-body">
        {entry.isSeries ? (
          <>
            {seasons.length > 1 && (
              <div className="seasons">
                {seasons.map((s) => (
                  <button key={s} data-focus className={s === season ? 'active' : ''} onClick={() => setSeason(s)}>
                    Season {s}
                  </button>
                ))}
              </div>
            )}
            <div className="eps">
              {eps.map((ep, i) => (
                <button key={`${ep.season}-${ep.episode}-${ep.file.id}`} className="ep" data-focus onClick={() => playEpisode(i)}>
                  <span className="n">{ep.episode}</span>
                  {ep.still
                    ? <img className="th" src={IMG(ep.still, 'w300')} alt="" loading="lazy" />
                    : <span className="th" />}
                  <span>
                    <span className="t">{ep.name || `Episode ${ep.episode}`}</span>
                    <span className="d">{ep.overview || ep.file.name}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="files" style={{ maxWidth: 900 }}>
            {entry.files.map((f, i) => (
              <button key={i} className="file" data-focus onClick={() => playMovie(i)}>
                <span style={{ display: 'flex' }}><IPlay size={14} /></span>
                <span className="nm">{f.file?.name || f.item.name}</span>
                <span className="sz">{fmtSize(f.file?.size || f.item.size)}</span>
              </button>
            ))}
          </div>
        )}

        {!!cast.length && (
          <section className="row" style={{ marginTop: 34 }}>
            <h2 style={{ padding: 0 }}><i />Cast</h2>
            <div className="track" style={{ padding: '6px 0 18px' }}>
              {cast.map((c) => (
                <div key={c.id} style={{ flex: '0 0 auto', width: 108, textAlign: 'center' }}>
                  <div style={{ width: 108, height: 108, borderRadius: '50%', overflow: 'hidden', background: '#151517', margin: '0 auto 8px' }}>
                    {c.profile_path && <img src={IMG(c.profile_path, 'w185')} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: '#9a9aa2' }}>{c.character}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {!!entry.subs.length && (
          <div style={{ marginTop: 26, color: '#9a9aa2', fontSize: 12 }}>
            Subtitle files detected: {entry.subs.map((s) => s.file.name).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}
