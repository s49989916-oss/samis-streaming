import { useEffect, useMemo, useRef, useState } from 'react';
import { Poster, Row } from './components/Card';
import Player, { type PlayRequest } from './components/Player';
import Detail from './pages/Detail';
import Browse from './pages/Browse';
import TitlePage from './pages/Title';
import RawCloud from './pages/RawCloud';
import {
  getCloud, getHealth, loadProgress, title as tname,
  type CloudResponse, type Progress, type TmdbItem,
} from './lib/api';
import { enrich, groupCloud, mergeByTmdb, type Entry } from './lib/library';
import { browse, type Kind, type Lang } from './lib/catalog';
import { focusFirst, installSpatial } from './lib/spatial';
import { getServer, installApiBase, isNative } from './lib/host';
import Setup from './pages/Setup';
import { ISearch, IRefresh, IPlay } from './components/Icons';

type View =
  | { name: 'home' }
  | { name: 'browse'; kind: Kind; lang: Lang }
  | { name: 'title'; kind: Kind; id: number; lang: Lang }
  | { name: 'detail'; key: string }
  | { name: 'cloud' }
  | { name: 'search' };

const ROWS: { title: string; note: string; kind: Kind; lang: Lang; sort?: string }[] = [
  { title: 'Trending Turkish Series', note: 'dizi', kind: 'tv', lang: 'tr' },
  { title: 'Turkish Movies', note: 'sinema', kind: 'movie', lang: 'tr' },
  { title: 'Hindi Hits', note: 'bollywood', kind: 'movie', lang: 'hi' },
  { title: 'Hindi Series', note: 'web series', kind: 'tv', lang: 'hi' },
  { title: 'Hollywood English', note: 'movies', kind: 'movie', lang: 'en' },
  { title: 'English Series', note: 'shows', kind: 'tv', lang: 'en' },
  { title: 'English Dubbed', note: 'dual audio', kind: 'movie', lang: 'dub' },
  { title: 'Top Rated Movies', note: 'all time', kind: 'movie', lang: 'en', sort: 'vote_average.desc' },
];

export default function App() {
  const [health, setHealth] = useState<{ tmdb: boolean; torbox: boolean; ffmpeg?: boolean } | null>(null);
  const [cloud, setCloud] = useState<CloudResponse | null>(null);
  const [lib, setLib] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadMsg, setLoadMsg] = useState('Connecting to your TorBox cloud…');
  const [error, setError] = useState('');
  const [view, setView] = useState<View>({ name: 'home' });
  const [play, setPlay] = useState<PlayRequest | null>(null);
  // APK only: the bundled UI must be told where the server lives.
  const [needSetup, setNeedSetup] = useState(() => isNative() && !getServer());
  // ?setup=1 opens the same screen in a desktop browser, handy for testing the APK flow
  const [showSetup, setShowSetup] = useState(() =>
    typeof location !== 'undefined' && new URLSearchParams(location.search).has('setup'));
  const [progress, setProgress] = useState<Progress[]>([]);
  const [rows, setRows] = useState<Record<string, TmdbItem[]>>({});
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [solid, setSolid] = useState(false);
  const stack = useRef<View[]>([]);

  /* --------------------------------- bootstrap -------------------------------- */
  const refresh = async () => {
    setLoading(true); setError('');
    try {
      const h = await getHealth();
      setHealth(h);
      if (!h.torbox) { setError('TORBOX_API_KEY is not configured in .env — add it and restart.'); setLoading(false); return; }
      setLoadMsg('Reading your cloud…');
      const c = await getCloud();
      setCloud(c);
      const grouped = groupCloud(c.items);
      setLib(grouped);
      setLoading(false);
      if (h.tmdb && grouped.length) {
        setLoadMsg('Matching artwork…');
        await enrich(grouped);
        setLib(mergeByTmdb(grouped));
      }
    } catch (e: any) {
      setError(e?.message || 'Could not reach the API server.');
      setLoading(false);
    }
  };
  useEffect(() => { refresh(); setProgress(loadProgress()); }, []);
  useEffect(() => { if (!play) setProgress(loadProgress()); }, [play]);

  // TMDB discovery rows for the home page (the whole catalogue, not just the cloud)
  useEffect(() => {
    if (!health?.tmdb) return;
    let dead = false;
    (async () => {
      for (const r of ROWS) {
        try {
          const res = await browse({ kind: r.kind, lang: r.lang, sort: r.sort });
          if (!dead) setRows((x) => ({ ...x, [r.title]: res.results }));
        } catch { /* row stays empty */ }
      }
    })();
    return () => { dead = true; };
  }, [health?.tmdb]);

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* ------------------------------- navigation -------------------------------- */
  const go = (v: View) => { stack.current.push(view); setView(v); window.scrollTo({ top: 0 }); };
  const back = () => {
    if (play) { setPlay(null); return; }
    const p = stack.current.pop();
    setView(p || { name: 'home' });
  };
  useEffect(() => installSpatial({ onBack: back, intercept: () => Boolean(play) || needSetup }), [play, view, needSetup]);
  useEffect(() => { if (!play) setTimeout(() => focusFirst(), 260); }, [view, play, lib.length]);

  /* -------------------------------- selectors -------------------------------- */
  const byKey = useMemo(() => new Map(lib.map((e) => [e.key, e])), [lib]);
  const main = (e: Entry) => !e.isExtra;
  const pick = (f: (e: Entry) => boolean) => lib.filter(f);
  const cloudTr = pick((e) => e.language === 'tr' && main(e));
  const cloudHi = pick((e) => e.language === 'hi' && main(e));
  const cloudEn = pick((e) => e.language === 'en' && main(e));
  const cloudOther = pick((e) => e.language === 'other' && main(e));

  const hero = useMemo(() => {
    const fromRows = rows['Trending Turkish Series']?.find((i) => i.backdrop_path);
    const fromCloud = lib.find((e) => e.backdrop && main(e));
    return fromCloud || (fromRows ? {
      key: `tmdb:tv:${fromRows.id}`, title: tname(fromRows), overview: fromRows.overview,
      backdrop: fromRows.backdrop_path, poster: fromRows.poster_path,
      tmdbId: fromRows.id, tmdbType: 'tv' as const, isSeries: true, langs: ['Turkish'],
      episodes: [], files: [], subs: [], size: 0, added: 0, language: 'tr' as const,
    } as unknown as Entry : null);
  }, [lib, rows]);

  const searchLib = useMemo(() => {
    const s = submitted.trim().toLowerCase();
    if (!s) return [];
    return lib.filter((e) => e.title.toLowerCase().includes(s));
  }, [submitted, lib]);

  const openEntry = (e: Entry) => {
    if (byKey.has(e.key)) go({ name: 'detail', key: e.key });
    else if (e.tmdbId) go({ name: 'title', kind: e.tmdbType || 'tv', id: e.tmdbId, lang: (e.language === 'other' ? 'en' : e.language) as Lang });
  };
  const openTmdb = (kind: Kind, id: number, lang: Lang) => go({ name: 'title', kind, id, lang });

  const resumeItem = (p: Progress) => setPlay({
    key: p.key, title: p.title, subtitle: p.sub, poster: p.poster, backdrop: p.backdrop,
    kind: p.kind, itemId: p.itemId, fileId: p.fileId, fileName: p.fileName,
    subFiles: byKey.get(p.key.split('::')[0])?.subs || [],
  });

  const detailEntry = view.name === 'detail' ? byKey.get(view.key) : undefined;
  const doSearch = (e?: React.FormEvent) => { e?.preventDefault(); setSubmitted(q); if (view.name !== 'search') go({ name: 'search' }); };

  /* ---------------------------------- render --------------------------------- */
  return (
    <>
      <header className={`topbar ${solid ? 'solid' : ''}`}>
        <div className="brand" onClick={() => setView({ name: 'home' })} style={{ cursor: 'pointer' }}>
          <b>SAMI'S</b> <span>STREAMING</span>
        </div>
        <nav className="nav">
          <button data-focus className={view.name === 'home' ? 'active' : ''} onClick={() => setView({ name: 'home' })}>Home</button>
          <button data-focus className={view.name === 'browse' && view.kind === 'movie' ? 'active' : ''}
            onClick={() => go({ name: 'browse', kind: 'movie', lang: 'tr' })}>Movies</button>
          <button data-focus className={view.name === 'browse' && view.kind === 'tv' ? 'active' : ''}
            onClick={() => go({ name: 'browse', kind: 'tv', lang: 'tr' })}>Series</button>
          <button data-focus className={view.name === 'cloud' ? 'active' : ''} onClick={() => go({ name: 'cloud' })}>My Cloud</button>
        </nav>
        <div className="spacer" />
        <form className="search" onSubmit={doSearch}>
          <span style={{ display: 'flex', color: '#9a9aa2' }}><ISearch /></span>
          <input placeholder="Search everything…" value={q}
            onChange={(e) => setQ(e.target.value)} onFocus={() => setView((v) => v.name === 'search' ? v : v)} />
          <button data-focus type="submit" className="tag" style={{ cursor: 'pointer' }}>Go</button>
        </form>
        <span className={`chip ${health?.torbox ? 'ok' : 'bad'}`} title="TorBox">TB {health?.torbox ? '✓' : '✗'}</span>
        <span className={`chip ${health?.tmdb ? 'ok' : 'bad'}`} title="TMDB">DB {health?.tmdb ? '✓' : '✗'}</span>
        <span className={`chip ${health?.ffmpeg ? 'ok' : ''}`} title="ffmpeg converter">FF {health?.ffmpeg ? '✓' : '–'}</span>
        {isNative() && (
          <button className="chip" data-focus title="Change server address"
            onClick={() => setShowSetup(true)}>SERVER</button>
        )}
        <button className="chip" data-focus onClick={refresh} title="Refresh cloud"
          style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}><IRefresh /></button>
      </header>

      {view.name === 'home' && (
        <main>
          {hero ? (
            <section className="hero">
              <div className="hero-media">
                {hero.backdrop
                  ? <img src={`https://image.tmdb.org/t/p/original${hero.backdrop}`} alt="" className="gpu" />
                  : <div className="skel" style={{ width: '100%', height: '100%' }} />}
              </div>
              <div className="hero-fade" />
              <div className="hero-body fadein">
                <div className="meta">
                  <span className="tag gold">{byKey.has(hero.key) ? 'IN YOUR CLOUD' : 'FEATURED'}</span>
                  {hero.quality && <span className="tag">{hero.quality}</span>}
                  {hero.isSeries && !!hero.episodes.length && <span className="tag">{hero.episodes.length} EPISODES</span>}
                  {hero.langs.map((l) => <span className="tag" key={l}>{l}</span>)}
                </div>
                <h1>{hero.title}</h1>
                <p>{hero.overview || 'Ready to stream.'}</p>
                <div className="row-btns">
                  <button className="btn btn-primary" data-focus data-focus-default="true" onClick={() => openEntry(hero)}><IPlay size={16} /> Play</button>
                  <button className="btn btn-ghost" data-focus onClick={() => openEntry(hero)}>More info</button>
                </div>
              </div>
            </section>
          ) : <div style={{ height: 96 }} />}

          <div className="rows">
            {loading && <div className="empty">{loadMsg}</div>}
            {error && <div className="err">{error}</div>}
            {!!cloud?.errors?.length && <div className="err">TorBox: {cloud.errors.join(' · ')}</div>}

            <Row title="Continue Watching" note="resume">
              {progress.filter((p) => p.duration && p.time / p.duration < 0.97).map((p) => (
                <Poster key={p.key} wide img={p.backdrop || p.poster} title={p.title} sub={p.sub}
                  progress={p.time / p.duration} badge="RESUME" onClick={() => resumeItem(p)} />
              ))}
            </Row>

            <Row title="My TorBox Cloud" note={`${lib.length} titles ready`}>
              {lib.filter(main).slice(0, 30).map((e) => (
                <Poster key={e.key} img={e.poster} title={e.title} badge={e.quality}
                  sub={e.isSeries ? `${e.episodes.length} eps` : e.year} onClick={() => openEntry(e)} />
              ))}
            </Row>

            {ROWS.map((r) => (
              <Row key={r.title} title={r.title} note={r.note}>
                {(rows[r.title] || []).map((i) => (
                  <Poster key={`${r.title}-${i.id}`} img={i.poster_path} title={tname(i)}
                    sub={(i.release_date || i.first_air_date || '').slice(0, 4)}
                    badge={i.vote_average ? `★ ${i.vote_average.toFixed(1)}` : undefined}
                    onClick={() => openTmdb(r.kind, i.id, r.lang)} />
                ))}
              </Row>
            ))}

            <Row title="Turkish · in your cloud" note="ready now">
              {cloudTr.map((e) => <Poster key={e.key} img={e.poster} title={e.title} badge={e.quality}
                sub={e.isSeries ? `${e.episodes.length} eps` : e.year} onClick={() => openEntry(e)} />)}
            </Row>
            <Row title="Hindi · in your cloud" note="ready now">
              {cloudHi.map((e) => <Poster key={e.key} img={e.poster} title={e.title} badge={e.quality}
                sub={e.isSeries ? `${e.episodes.length} eps` : e.year} onClick={() => openEntry(e)} />)}
            </Row>
            <Row title="English · in your cloud" note="ready now">
              {cloudEn.map((e) => <Poster key={e.key} img={e.poster} title={e.title} badge={e.quality}
                sub={e.isSeries ? `${e.episodes.length} eps` : e.year} onClick={() => openEntry(e)} />)}
            </Row>
            <Row title="Unsorted cloud files" note="no language match">
              {cloudOther.map((e) => <Poster key={e.key} img={e.poster} title={e.title} onClick={() => openEntry(e)} />)}
            </Row>
          </div>
        </main>
      )}

      {view.name === 'browse' && (
        <Browse initialKind={view.kind} initialLang={view.lang} onOpen={openTmdb} />
      )}

      {view.name === 'search' && (
        <>
          {!!searchLib.length && (
            <div style={{ paddingTop: 92 }}>
              <Row title="In your cloud" note="instant">
                {searchLib.map((e) => (
                  <Poster key={e.key} img={e.poster} title={e.title} badge="READY"
                    sub={e.isSeries ? `${e.episodes.length} eps` : e.year} onClick={() => openEntry(e)} />
                ))}
              </Row>
            </div>
          )}
          <div style={{ marginTop: searchLib.length ? -40 : 0 }}>
            <Browse query={submitted} initialKind="movie" initialLang="en" onOpen={openTmdb} />
          </div>
        </>
      )}

      {view.name === 'cloud' && <RawCloud cloud={cloud} onPlay={setPlay} onRefresh={refresh} loading={loading} />}

      {view.name === 'detail' && detailEntry && <Detail entry={detailEntry} onBack={back} onPlay={setPlay} />}
      {view.name === 'detail' && !detailEntry && (
        <div className="empty" style={{ paddingTop: 120 }}>
          That title is no longer in your cloud. <button className="btn btn-ghost" data-focus onClick={back}>Back</button>
        </div>
      )}

      {view.name === 'title' && (
        <TitlePage kind={view.kind} id={view.id} lang={view.lang} onBack={back} onPlay={setPlay} />
      )}

      {play && <Player req={play} onClose={() => setPlay(null)} />}

      {(needSetup || showSetup) && (
        <Setup
          canCancel={!needSetup}
          onDone={() => { setNeedSetup(false); setShowSetup(false); location.reload(); }}
        />
      )}
    </>
  );
}
