import { useEffect, useRef, useState } from 'react';
import { Poster } from '../components/Card';
import { browse, genres, LANGS, type Kind, type Lang } from '../lib/catalog';
import { title as tt, type TmdbItem } from '../lib/api';
import { focusFirst } from '../lib/spatial';

const SORTS = [
  { id: 'popularity.desc', label: 'Popular' },
  { id: 'vote_average.desc', label: 'Top rated' },
  { id: 'primary_release_date.desc', label: 'Newest' },
];

export default function Browse({
  onOpen, initialKind = 'movie', initialLang = 'tr', query,
}: {
  onOpen: (kind: Kind, id: number, lang: Lang) => void;
  initialKind?: Kind; initialLang?: Lang; query?: string;
}) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [lang, setLang] = useState<Lang>(initialLang);
  const [genre, setGenre] = useState<number | undefined>();
  const [sort, setSort] = useState(SORTS[0].id);
  const [gs, setGs] = useState<{ id: number; name: string }[]>([]);
  const [items, setItems] = useState<TmdbItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(1);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const sent = useRef<HTMLDivElement>(null);

  useEffect(() => { genres(kind).then(setGs).catch(() => {}); }, [kind]);
  useEffect(() => { setItems([]); setPage(1); }, [kind, lang, genre, sort, query]);

  useEffect(() => {
    let dead = false;
    setBusy(true); setErr('');
    const sortFix = kind === 'tv' && sort === 'primary_release_date.desc' ? 'first_air_date.desc' : sort;
    browse({ kind, lang, genre, page, sort: sortFix, query })
      .then((r) => {
        if (dead) return;
        setItems((prev) => (page === 1 ? r.results : [...prev, ...r.results]));
        setTotal(r.total);
        setTimeout(() => page === 1 && focusFirst(), 150);
      })
      .catch((e) => !dead && setErr(e.message))
      .finally(() => !dead && setBusy(false));
    return () => { dead = true; };
  }, [kind, lang, genre, sort, page, query]);

  // infinite scroll
  useEffect(() => {
    const el = sent.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (e[0].isIntersecting && !busy && page < total) setPage((p) => p + 1);
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [busy, page, total]);

  const activeLang = LANGS.find((l) => l.id === lang)!;

  return (
    <main style={{ paddingTop: 92, paddingBottom: 90 }}>
      <div style={{ padding: '0 clamp(16px,4vw,54px)', display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="seasons" style={{ margin: 0 }}>
            <button data-focus className={kind === 'movie' ? 'active' : ''} onClick={() => setKind('movie')}>Movies</button>
            <button data-focus className={kind === 'tv' ? 'active' : ''} onClick={() => setKind('tv')}>Series</button>
          </div>
          <span style={{ width: 14 }} />
          <div className="seasons" style={{ margin: 0 }}>
            {LANGS.map((l) => (
              <button key={l.id} data-focus className={lang === l.id ? 'active' : ''} onClick={() => setLang(l.id)}>{l.label}</button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <div className="seasons" style={{ margin: 0 }}>
            {SORTS.map((s) => (
              <button key={s.id} data-focus className={sort === s.id ? 'active' : ''} onClick={() => setSort(s.id)}>{s.label}</button>
            ))}
          </div>
        </div>

        <div className="track" style={{ padding: '2px 0 4px', gap: 8 }}>
          <button data-focus className={`tag ${!genre ? 'gold' : ''}`} style={{ flex: '0 0 auto', cursor: 'pointer' }}
            onClick={() => setGenre(undefined)}>All genres</button>
          {gs.map((g) => (
            <button key={g.id} data-focus className={`tag ${genre === g.id ? 'gold' : ''}`}
              style={{ flex: '0 0 auto', cursor: 'pointer' }} onClick={() => setGenre(g.id)}>{g.name}</button>
          ))}
        </div>

        <div style={{ color: '#8a8a92', fontSize: 12 }}>
          {query ? `Search "${query}"` : `${activeLang.label} · ${activeLang.note}`}
          {lang === 'dub' && ' — sources are filtered to dual-audio / English-dubbed releases'}
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      <div className="grid" style={{ paddingTop: 18 }}>
        {items.map((i, idx) => (
          <Poster key={`${i.id}-${idx}`} img={i.poster_path} title={tt(i)}
            sub={(i.release_date || i.first_air_date || '').slice(0, 4)}
            badge={i.vote_average ? `★ ${i.vote_average.toFixed(1)}` : undefined}
            onClick={() => onOpen(kind, i.id, lang)} />
        ))}
      </div>
      <div ref={sent} style={{ height: 40 }} />
      {busy && <div className="empty">Loading…</div>}
      {!busy && !items.length && !err && <div className="empty">Nothing found.</div>}
    </main>
  );
}
