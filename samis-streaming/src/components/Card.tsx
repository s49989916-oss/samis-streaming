import { useState } from 'react';
import { IMG } from '../lib/api';

export function Poster({
  img, title, badge, progress, wide, onClick, sub,
}: {
  img?: string; title: string; badge?: string; progress?: number; wide?: boolean;
  onClick: () => void; sub?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const src = img ? IMG(img, wide ? 'w780' : 'w500') : '';
  return (
    <button className={`card gpu ${wide ? 'wide' : ''}`} data-focus onClick={onClick} title={title}>
      {src ? (
        <img src={src} alt={title} loading="lazy" className={loaded ? 'loaded' : ''} onLoad={() => setLoaded(true)} />
      ) : (
        <div className="ph">{title}</div>
      )}
      {!src && <div className="skel" style={{ position: 'absolute', inset: 0, zIndex: -1 }} />}
      {badge && <span className="badge">{badge}</span>}
      <span className="cap">{title}{sub ? <><br /><span style={{ color: '#a5a5ad', fontWeight: 500 }}>{sub}</span></> : null}</span>
      {progress ? <span className="prog"><i style={{ width: `${Math.min(100, progress * 100)}%` }} /></span> : null}
    </button>
  );
}

export function Row({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  const kids = Array.isArray(children) ? children.filter(Boolean) : children;
  if (Array.isArray(kids) && kids.length === 0) return null;
  return (
    <section className="row fadein">
      <h2><i />{title}{note && <small>{note}</small>}</h2>
      <div className="track">{kids}</div>
    </section>
  );
}
