import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IMG, fmtSize } from '../lib/api';
import { details, season as fetchSeason, findSources, type Details, type Kind, type Lang, type Source } from '../lib/catalog';
import { resolvePlay, isAbort, type Stage } from '../lib/play';
import type { PlayRequest } from '../components/Player';
import { focusFirst } from '../lib/spatial';
import { IPlay, ICog, IWarn } from '../components/Icons';

const langsFor = (lang: Lang, d?: Details): string[] => {
  if (lang === 'tr' || d?.language === 'tr') return ['turkish', 'urdu', 'english'];
  if (lang === 'hi' || d?.language === 'hi') return ['hindi', 'urdu', 'english'];
  if (lang === 'dub') return ['english', 'dual'];
  return ['english'];
};

export default function Title({
  kind, id, lang, onBack, onPlay,
}: { kind: Kind; id: number; lang: Lang; onBack: () => void; onPlay: (p: PlayRequest) => void }) {
  const [d, setD] = useState<Details | null>(null);
  const [err, setErr] = useState('');
  const [seasonNo, setSeasonNo] = useState(1);
  const [eps, setEps] = useState<any[]>([]);
  const [stage, setStage] = useState<Stage | null>(null);
  const openAbort = useRef<AbortController | null>(null);

  /** Cancel an in-flight open: aborts the poll AND closes the overlay for good. */
  const cancelOpen = useCallback(() => {
    openAbort.current?.abort();
    openAbort.current = null;
    setStage(null);
  }, []);
  useEffect(() => () => openAbort.current?.abort(), []);

  // Esc / TV Back dismisses the "opening" overlay first, before leaving the page.
  useEffect(() => {
    if (!stage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'BrowserBack' || e.keyCode === 10009) {
        e.preventDefault(); e.stopImmediatePropagation(); cancelOpen();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [stage, cancelOpen]);
  const [sources, setSources] = useState<Source[] | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [pendingEp, setPendingEp] = useState<number | undefined>();
  const [trailerOn, setTrailerOn] = useState(false);
  const [magnet, setMagnet] = useState('');
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    setD(null); setErr(''); setEps([]); setSources(null);
    details(kind, id).then((x) => {
      if (!alive.current) return;
      setD(x);
      if (kind === 'tv' && x.seasons.length) setSeasonNo(x.seasons[0].season_number);
      setTimeout(() => focusFirst(), 180);
    }).catch((e) => setErr(e.message));
    const t = setTimeout(() => setTrailerOn(true), 3200);
    return () => { alive.current = false; clearTimeout(t); };
  }, [kind, id]);

  useEffect(() => {
    if (kind !== 'tv' || !d) return;
    fetchSeason(d.id, seasonNo).then((s: any) => alive.current && setEps(s.episodes || [])).catch(() => setEps([]));
  }, [kind, d, seasonNo]);

  const wantLangs = useMemo(() => langsFor(lang, d || undefined), [lang, d]);

  const play = async (episode?: number, preferred?: Source) => {
    if (!d) return;
    openAbort.current?.abort();
    const ctl = new AbortController();
    openAbort.current = ctl;
    setStage({ text: 'Starting…' });
    try {
      const req = await resolvePlay({
        title: d.title, imdb: d.imdb, year: d.year,
        alt: [d.originalTitle || '', ...d.altTitles].filter(Boolean),
        season: kind === 'tv' ? seasonNo : undefined,
        episode,
        langs: wantLangs,
        dubbed: lang === 'dub',
        poster: d.poster, backdrop: d.backdrop,
        subtitle: episode !== undefined ? `S${seasonNo} E${episode}` : d.year,
        keyPrefix: `tmdb:${kind}:${d.id}`,
        preferred,
        onStage: (s) => { if (alive.current && !ctl.signal.aborted) setStage(s); },
        signal: ctl.signal,
      });
      if (ctl.signal.aborted) return;
      openAbort.current = null;
      setStage(null);
      onPlay(req);
    } catch (e: any) {
      if (isAbort(e) || ctl.signal.aborted) { setStage(null); return; }
      setStage({ text: `⚠ ${e.message}` });
    }
  };

  const loadSources = async (episode?: number) => {
    if (!d) return;
    setPendingEp(episode);
    setShowSources(true);
    setSources(null);
    try {
      const r = await findSources({
        imdb: d.imdb, title: d.title, year: d.year,
        alt: [d.originalTitle || '', ...d.altTitles].filter(Boolean),
        season: kind === 'tv' ? seasonNo : undefined, episode,
        langs: wantLangs, dubbed: lang === 'dub',
      });
      if (alive.current) { setSources(r.sources); setTimeout(() => focusFirst(), 120); }
    } catch (e: any) {
      if (alive.current) { setSources([]); setErr(e.message); }
    }
  };

  if (err && !d) return <div className="empty" style={{ paddingTop: 120 }}>{err} <button className="btn btn-ghost" data-focus onClick={onBack}>Back</button></div>;
  if (!d) return <div className="empty" style={{ paddingTop: 140 }}>Loading…</div>;

  return (
    <div className="detail">
      <div className="detail-hero">
        <div className="hero-media">
          {trailerOn && d.trailer ? (
            <iframe title="trailer" allow="autoplay; encrypted-media"
              src={`https://www.youtube.com/embed/${d.trailer}?autoplay=1&mute=1&controls=0&loop=1&playlist=${d.trailer}&modestbranding=1&rel=0`} />
          ) : d.backdrop ? <img src={IMG(d.backdrop, 'original')} alt="" className="gpu" />
            : <div className="skel" style={{ width: '100%', height: '100%' }} />}
        </div>
        <div className="hero-fade" />
        <div className="hero-body fadein">
          <div className="meta">
            {d.year && <span className="tag">{d.year}</span>}
            {d.rating ? <span className="tag gold">★ {d.rating.toFixed(1)}</span> : null}
            {d.genres.slice(0, 3).map((g) => <span className="tag" key={g}>{g}</span>)}
            {kind === 'tv' && <span className="tag">{d.seasons.length} SEASONS</span>}
            {lang === 'dub' && <span className="tag gold">ENGLISH DUBBED</span>}
          </div>
          <h1>{d.title}</h1>
          <p>{d.overview}</p>
          <div className="row-btns">
            <button className="btn btn-primary" data-focus data-focus-default="true"
              onClick={() => play(kind === 'tv' ? (eps[0]?.episode_number ?? 1) : undefined)}>
              <IPlay size={16} /> Play{kind === 'tv' ? ` S${seasonNo} E${eps[0]?.episode_number ?? 1}` : ''}
            </button>
            <button className="btn btn-gold" data-focus onClick={() => loadSources(kind === 'tv' ? (eps[0]?.episode_number ?? 1) : undefined)}>
              <ICog size={15} /> Choose source
            </button>
            <button className="btn btn-ghost" data-focus onClick={onBack}>← Back</button>
          </div>
        </div>
      </div>

      <div className="detail-body">
        {kind === 'tv' && (
          <>
            <div className="seasons">
              {d.seasons.map((s) => (
                <button key={s.season_number} data-focus className={s.season_number === seasonNo ? 'active' : ''}
                  onClick={() => setSeasonNo(s.season_number)}>
                  {s.name || `Season ${s.season_number}`}
                </button>
              ))}
            </div>
            <div className="eps">
              {eps.map((ep) => (
                <button key={ep.id} className="ep" data-focus onClick={() => play(ep.episode_number)}>
                  <span className="n">{ep.episode_number}</span>
                  {ep.still_path ? <img className="th" src={IMG(ep.still_path, 'w300')} alt="" loading="lazy" /> : <span className="th" />}
                  <span>
                    <span className="t">{ep.name}</span>
                    <span className="d">{ep.overview || 'No description.'}</span>
                  </span>
                </button>
              ))}
              {!eps.length && <div className="empty" style={{ padding: 20 }}>No episode list for this season.</div>}
            </div>
          </>
        )}

        {!!d.cast.length && (
          <section className="row" style={{ marginTop: 30 }}>
            <h2 style={{ padding: 0 }}><i />Cast</h2>
            <div className="track" style={{ padding: '6px 0 18px' }}>
              {d.cast.map((c) => (
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
      </div>

      {/* ---------------- resolver overlay ---------------- */}
      {stage && (
        <div className="center" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.82)', zIndex: 150 }}
          onClick={(e) => { if (e.target === e.currentTarget) cancelOpen(); }}>
          <div className="glass" style={{ padding: 28, width: 'min(460px,90vw)', textAlign: 'center' }}>
            {!stage.text.startsWith('⚠') && <div className="spin" style={{ margin: '0 auto 16px' }} />}
            <div style={{ fontSize: 14, lineHeight: 1.6 }}>{stage.text}</div>
            {stage.pct !== undefined && stage.pct > 0 && (
              <div className="bar" style={{ marginTop: 16 }}><div className="cur" style={{ width: `${stage.pct}%` }} /></div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18 }}>
              {stage.text.startsWith('⚠') && (
                <button className="btn btn-gold" data-focus data-focus-default="true"
                  onClick={() => { cancelOpen(); loadSources(pendingEp); }}>Pick a source manually</button>
              )}
              <button className="btn btn-ghost" data-focus onClick={cancelOpen}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- source picker ---------------- */}
      {showSources && (
        <div className="center" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.86)', zIndex: 150, alignItems: 'start', paddingTop: 80 }}>
          <div className="glass" style={{ padding: 20, width: 'min(860px,94vw)', maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>
                Sources — {d.title}{pendingEp !== undefined ? ` S${seasonNo} E${pendingEp}` : ''}
              </h3>
              <div style={{ flex: 1 }} />
              <button className="btn btn-ghost" data-focus onClick={() => setShowSources(false)}>Close</button>
            </div>
            {!sources && <div className="empty" style={{ padding: 20 }}>Searching indexers + your TorBox cache…</div>}
            {sources && !sources.length && (
              <div className="empty" style={{ padding: '14px 4px', lineHeight: 1.7 }}>
                No public source matched this exact title/episode.<br />
                <span style={{ fontSize: 12 }}>
                  Tip: Turkish shows are often indexed under their romanised name (e.g. “Kurulus Osman”).
                  You can also paste a magnet link or info-hash below.
                </span>
              </div>
            )}
            <form className="search" style={{ margin: '12px 0 4px' }}
              onSubmit={(e) => { e.preventDefault(); const v = magnet.trim(); if (!v) return;
                const h = (v.match(/btih:([a-fA-F0-9]{40})/) || [])[1] || (/^[a-fA-F0-9]{40}$/.test(v) ? v : '');
                if (!h) { setErr('That is not a valid magnet link or 40-character info-hash.'); return; }
                setShowSources(false);
                play(pendingEp, { hash: h.toLowerCase(), name: d.title, size: 0, seeders: 0, audio: [], score: 0, compat: 'direct' } as Source);
              }}>
              <input placeholder="…or paste a magnet link / info-hash" value={magnet}
                onChange={(e) => setMagnet(e.target.value)} style={{ width: '100%' }} />
              <button data-focus type="submit" className="tag" style={{ cursor: 'pointer' }}>Add</button>
            </form>
            <div className="files">
              {(sources || []).map((s) => (
                <button key={s.hash} className="file" data-focus
                  onClick={() => { setShowSources(false); play(pendingEp, s); }}>
                  <span className={`tag ${s.cached ? 'gold' : ''}`}>{s.cached ? 'INSTANT' : 'DOWNLOAD'}</span>
                  <span className="nm">
                    {s.name}
                    <br />
                    <span style={{ color: '#8a8a92', fontSize: 11 }}>
                      {[s.quality, s.codec, s.compat === 'convert' ? 'needs convert' : 'plays direct',
                        `${s.seeders} seeders`, fmtSize(s.size), ...s.audio].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
