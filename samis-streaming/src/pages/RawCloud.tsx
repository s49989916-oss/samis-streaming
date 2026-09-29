import { useState } from 'react';
import { fmtSize, playability, type CloudResponse } from '../lib/api';
import type { PlayRequest } from '../components/Player';
import { ISearch, IRefresh, IPlay } from '../components/Icons';

/** Raw, unfiltered view of the TorBox cloud — every torrent / usenet / webdl item
    and every file inside it, playable directly. Nothing is hidden. */
export default function RawCloud({
  cloud, onPlay, onRefresh, loading,
}: { cloud: CloudResponse | null; onPlay: (p: PlayRequest) => void; onRefresh: () => void; loading: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState('');

  const items = (cloud?.items || []).filter((i) =>
    !filter || i.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <main style={{ paddingTop: 96, paddingBottom: 90 }}>
      <div style={{ padding: '0 clamp(16px,4vw,54px)', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 20, margin: 0 }}>My TorBox Cloud</h2>
        <span className="chip">{cloud?.counts?.torrent ?? 0} torrents</span>
        <span className="chip">{cloud?.counts?.usenet ?? 0} usenet</span>
        <span className="chip">{cloud?.counts?.webdl ?? 0} web</span>
        <div className="search"><span style={{ display: 'flex', color: '#9a9aa2' }}><ISearch /></span>
          <input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        <button className="btn btn-ghost" data-focus onClick={onRefresh}><IRefresh /> Refresh</button>
      </div>

      {loading && <div className="empty">Loading your cloud…</div>}
      {!!cloud?.errors?.length && <div className="err">{cloud.errors.join(' · ')}</div>}

      <div style={{ padding: '20px clamp(16px,4vw,54px) 0', display: 'grid', gap: 10 }}>
        {items.map((it) => (
          <div key={`${it.kind}-${it.id}`} className="glass" style={{ padding: 14 }}>
            <button className="file" data-focus style={{ border: 0, background: 'none', width: '100%' }}
              onClick={() => setOpen(open === it.id ? null : it.id)}>
              <span className="tag gold">{it.kind.toUpperCase()}</span>
              <span className="nm" style={{ fontWeight: 600 }}>{it.name}</span>
              {it.hasVideo === false && <span className="tag">NO VIDEO</span>}
              <span className="sz">{fmtSize(it.size)} · {it.files.length} files</span>
              <span>{open === it.id ? '▲' : '▼'}</span>
            </button>
            {open === it.id && (
              <div className="files fadein" style={{ marginTop: 10 }}>
                {(it.files.length ? it.files : [null]).map((f, i) => (
                  <button key={f?.id ?? i} className="file" data-focus
                    disabled={!!f && !f.isVideo && !f.isSub}
                    onClick={() => onPlay({
                      key: `raw:${it.kind}:${it.id}:${f?.id ?? 'all'}`,
                      title: f?.name || it.name,
                      subtitle: it.name !== (f?.name || it.name) ? it.name : undefined,
                      kind: it.kind, itemId: it.id, fileId: f?.id,
                      fileName: f?.name,
                      subFiles: it.files.filter((x) => x.isSub).map((x) => ({ file: x, item: it })),
                    })}>
                    <span style={{ display: 'flex', width: 18 }}>{!f || f.isVideo ? <IPlay size={14} /> : f.isSub ? <span className="tag">CC</span> : <span style={{ color: '#55555c' }}>·</span>}</span>
                    <span className="nm">{f?.name || it.name}</span>
                    {f?.isVideo && playability(f.name) === 'risky' &&
                      <span className="tag" title="HEVC / AC3-DTS: may need the built-in converter">CODEC?</span>}
                    <span className="sz">{fmtSize(f?.size || it.size)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {!loading && !items.length && <div className="empty">Nothing in your cloud matches.</div>}
      </div>
    </main>
  );
}
