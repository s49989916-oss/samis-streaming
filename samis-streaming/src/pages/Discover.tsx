import { useEffect, useState } from 'react';
import { Poster, Row } from '../components/Card';
import { tmdb, title as t, type TmdbItem } from '../lib/api';

const SECTIONS = [
  { title: 'Trending Turkish Series', path: 'discover/tv', params: { with_original_language: 'tr', sort_by: 'popularity.desc' } },
  { title: 'Turkish Movies', path: 'discover/movie', params: { with_original_language: 'tr', sort_by: 'popularity.desc' } },
  { title: 'Hindi Hits', path: 'discover/movie', params: { with_original_language: 'hi', sort_by: 'popularity.desc' } },
  { title: 'Hindi Series', path: 'discover/tv', params: { with_original_language: 'hi', sort_by: 'popularity.desc' } },
  { title: 'Hollywood English', path: 'discover/movie', params: { with_original_language: 'en', sort_by: 'popularity.desc' } },
  { title: 'English Series', path: 'discover/tv', params: { with_original_language: 'en', sort_by: 'popularity.desc' } },
];

/** Browse-only discovery (TMDB). Titles here are not in your cloud yet —
    it exists so you know what to grab into TorBox next. */
export default function Discover({ enabled }: { enabled: boolean }) {
  const [data, setData] = useState<Record<string, TmdbItem[]>>({});
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!enabled) return;
    (async () => {
      for (const s of SECTIONS) {
        try {
          const r: any = await tmdb(s.path, { ...s.params, page: 1 });
          setData((d) => ({ ...d, [s.title]: r.results || [] }));
        } catch (e: any) { setErr(e.message); }
      }
    })();
  }, [enabled]);

  return (
    <main style={{ paddingTop: 110, paddingBottom: 90 }}>
      <div className="empty" style={{ paddingTop: 0 }}>
        <b style={{ color: '#d4af37' }}>Discover</b> — powered by TMDB. Browse what's hot, then add it to TorBox;
        it shows up on Home automatically once cached.
      </div>
      {!enabled && <div className="err">TMDB_API_KEY is not set in .env.</div>}
      {err && <div className="err">{err}</div>}
      {SECTIONS.map((s) => (
        <Row key={s.title} title={s.title} note="tmdb">
          {(data[s.title] || []).map((i) => (
            <Poster key={i.id} img={i.poster_path} title={t(i)}
              sub={(i.release_date || i.first_air_date || '').slice(0, 4)}
              onClick={() => window.open(`https://www.themoviedb.org/${i.first_air_date ? 'tv' : 'movie'}/${i.id}`, '_blank')} />
          ))}
        </Row>
      ))}
    </main>
  );
}
