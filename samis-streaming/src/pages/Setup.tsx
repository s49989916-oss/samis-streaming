import { useEffect, useState } from 'react';
import { getServer, normalizeServer, pingServer, setServer } from '../lib/host';
import { ICheck, IWarn, IRefresh } from '../components/Icons';

/** First-run screen in the Android / TV app: point it at your Sami's Streaming server. */
export default function Setup({ onDone, canCancel }: { onDone: () => void; canCancel?: boolean }) {
  const [val, setVal] = useState(getServer());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState<any>(null);

  useEffect(() => { document.querySelector<HTMLInputElement>('#srv')?.focus(); }, []);

  const connect = async () => {
    const origin = normalizeServer(val);
    if (!origin) { setErr('That doesn’t look like an address. Try 192.168.1.20:8787'); return; }
    setBusy(true); setErr(''); setOk(null);
    const r = await pingServer(origin);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setOk(r.health);
    setServer(origin);
    setTimeout(onDone, 900);
  };

  return (
    <div className="center" style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 300, padding: 24 }}>
      <div className="glass" style={{ maxWidth: 560, width: '100%', padding: 30, textAlign: 'center' }}>
        <div style={{ fontSize: 12, letterSpacing: 3, color: 'var(--gold,#d9b46a)', fontWeight: 700 }}>SAMI’S STREAMING</div>
        <h2 style={{ margin: '10px 0 6px', fontSize: 22 }}>Connect to your server</h2>
        <p style={{ color: '#9a9aa2', fontSize: 13, lineHeight: 1.7, margin: '0 0 20px' }}>
          Your TorBox library and keys live on the computer running <b>npm start</b>.
          Enter its address — the app remembers it.
        </p>

        <input id="srv" data-focus className="inp" value={val} spellCheck={false}
          placeholder="192.168.1.20:8787"
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && connect()}
          style={{
            width: '100%', padding: '14px 16px', fontSize: 16, borderRadius: 12, textAlign: 'center',
            background: 'rgba(255,255,255,.06)', color: '#fff', caretColor: '#d9b46a',
            border: '1px solid rgba(255,255,255,.16)', outline: 'none', letterSpacing: .3,
          }} />

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
          <button className="btn btn-gold" data-focus disabled={busy} onClick={connect}>
            {busy ? <><IRefresh /> Checking…</> : 'Connect'}
          </button>
          {canCancel && <button className="btn btn-ghost" data-focus onClick={onDone}>Cancel</button>}
        </div>

        {ok && (
          <p style={{ color: '#7fd18b', fontSize: 13, marginTop: 16 }}>
            <ICheck /> Connected — TorBox {ok.torbox ? '✓' : '✕'} · TMDB {ok.tmdb ? '✓' : '✕'} · ffmpeg {ok.ffmpeg ? '✓' : '–'}
          </p>
        )}
        {err && <p style={{ color: '#ff9b9b', fontSize: 13, marginTop: 16 }}><IWarn /> {err}</p>}

        <p style={{ color: '#6d6d75', fontSize: 11.5, lineHeight: 1.7, marginTop: 22, textAlign: 'left' }}>
          <b>Finding the address:</b> on the computer running the server, use its LAN IP and port 8787
          (Windows: <code>ipconfig</code> · macOS/Linux: <code>ip addr</code>). Phone and computer must be
          on the same Wi-Fi. If you host it on a VPS with HTTPS, paste the full
          <code> https://…</code> URL instead.
        </p>
      </div>
    </div>
  );
}
