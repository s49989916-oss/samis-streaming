import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtTime, getStreamUrl, saveProgress, getProgressFor, type CloudFile, type CloudItem } from '../lib/api';
import { parseAny, cueAt, guessSubLang, type Cue } from '../lib/subtitles';
import { apiUrl } from '../lib/host';
import { IPlay, IPause, IBack10, IFwd10, INext, IVol, IMute, IFull, IExitFull, IArrowLeft, ICog, IClose, IWarn } from './Icons';

export type SubSource = { label: string; url: string; name: string };
export type PlayRequest = {
  key: string; title: string; subtitle?: string; poster?: string; backdrop?: string;
  kind: string; itemId: number; fileId?: number; fileName?: string;
  subFiles?: { file: CloudFile; item: CloudItem | any }[];
  onNext?: () => void;
};

type Track = { id: string; label: string; apply: () => void };
type Panel = null | 'audio' | 'subs' | 'style' | 'speed';

const SUB_COLORS = ['#ffffff', '#ffe27a', '#d4af37', '#8ef5c0', '#9ad8ff', '#ff9ec0'];
const DEFAULT_STYLE = { size: 30, color: '#ffffff', bg: 0.55, shadow: true, pos: 11 };

export default function Player({ req, onClose }: { req: PlayRequest; onClose: () => void }) {
  const vRef = useRef<HTMLVideoElement>(null);
  const modeRef = useRef<'direct' | 'remux' | 'full'>('direct');
  const offsetRef = useRef(0);
  const hlsRef = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [msg, setMsg] = useState('Requesting secure stream link…');
  const [srcUrl, setSrcUrl] = useState('');
  const [ticket, setTicket] = useState('');
  const [mode, setMode] = useState<'direct' | 'remux' | 'full'>('direct');
  const [ffmpegOk, setFfmpegOk] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // virtual timeline: while ffmpeg streams a converted copy it always starts at 0,
  // so the real position is offset + video.currentTime.
  const [offset, setOffset] = useState(0);
  const [probe, setProbe] = useState<null | {
    ffprobe: boolean; duration: number; video?: any;
    audio: { id: number; lang: string; codec: string; channels: number; title: string; default: boolean }[];
    subs: { id: number; lang: string; codec: string; title: string }[];
  }>(null);
  const [audioSel, setAudioSel] = useState<number | null>(null);   // ffmpeg audio id

  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [buf, setBuf] = useState(0);
  const [vol, setVol] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [ui, setUi] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [toast, setToast] = useState('');
  const [scrub, setScrub] = useState<number | null>(null);
  const [fs, setFs] = useState(false);

  const [audioTracks, setAudioTracks] = useState<Track[]>([]);
  const [audioIdx, setAudioIdx] = useState(0);

  const [subSources, setSubSources] = useState<SubSource[]>([]);
  const [cuesA, setCuesA] = useState<Cue[]>([]);
  const [cuesB, setCuesB] = useState<Cue[]>([]);
  const [subA, setSubA] = useState('off');
  const [subB, setSubB] = useState('off');
  const [lineA, setLineA] = useState('');
  const [lineB, setLineB] = useState('');

  const [style, setStyle] = useState(() => {
    try { return { ...DEFAULT_STYLE, ...JSON.parse(localStorage.getItem('samis.substyle') || '{}') }; }
    catch { return DEFAULT_STYLE; }
  });
  useEffect(() => { localStorage.setItem('samis.substyle', JSON.stringify(style)); }, [style]);

  /* -------------------------------- UI timer -------------------------------- */
  const hideT = useRef<any>(null);
  const poke = useCallback((sticky = false) => {
    setUi(true);
    clearTimeout(hideT.current);
    if (!sticky) hideT.current = setTimeout(() => { setUi(false); setPanel(null); }, 4500);
  }, []);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { offsetRef.current = offset; }, [offset]);
  const probeRef = useRef<any>(null);
  useEffect(() => { probeRef.current = probe; }, [probe]);
  useEffect(() => { poke(); return () => clearTimeout(hideT.current); }, [poke]);
  useEffect(() => { if (panel) poke(true); else poke(); }, [panel, poke]);

  const flash = (t: string, ms = 900) => { setToast(t); setTimeout(() => setToast(''), ms); };

  /* --------------------------- 1. resolve stream link ------------------------- */
  useEffect(() => {
    let dead = false;
    (async () => {
      setStatus('loading'); setMsg('Requesting secure stream link…');
      try {
        fetch('/api/health').then((r) => r.json()).then((h) => !dead && setFfmpegOk(!!h.ffmpeg)).catch(() => {});
        const r = await getStreamUrl(req.kind, req.itemId, req.fileId);
        if (dead) return;
        setMode('direct'); setTicket(r.ticket || ''); setSrcUrl(r.url);
      } catch (e: any) {
        if (dead) return;
        setStatus('error');
        setMsg(e?.message || 'TorBox did not return a stream link for this file.');
      }
    })();
    return () => { dead = true; };
  }, [req.kind, req.itemId, req.fileId, attempt]);

  /* ----------------------- 1b. inspect the real track list -------------------- */
  useEffect(() => {
    if (!ticket) { setProbe(null); return; }
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`/api/tracks/${ticket}`);
        const j = await r.json();
        if (dead) return;
        setProbe(j);
        // remember the viewer's preferred audio language across titles
        const pref = localStorage.getItem('samis.audiolang') || '';
        if (j?.audio?.length > 1) {
          const wanted = j.audio.findIndex((a: any) => a.lang.toLowerCase() === pref.toLowerCase());
          if (wanted > 0) switchAudio(wanted, true);
        }
      } catch { /* probing is optional */ }
    })();
    return () => { dead = true; };
  }, [ticket]);

  /* ------------------------------ 2. attach source ---------------------------- */
  useEffect(() => {
    const v = vRef.current;
    if (!v || !srcUrl) return;
    const play = apiUrl(mode === 'direct'
      ? srcUrl
      : `/api/transcode/${ticket}?mode=${mode === 'full' ? 'full' : 'remux'}`
        + `&a=${audioSel ?? 0}&t=${Math.floor(offset)}`);
    setMsg(mode === 'direct' ? 'Buffering…' : 'Converting this file for your browser…');

    hlsRef.current?.destroy?.(); hlsRef.current = null;
    let cancelled = false;

    const startHls = async () => {
      const { default: Hls } = await import('hls.js');
      if (cancelled) return;
      if (!Hls.isSupported()) { v.src = play; v.load(); v.play().catch(() => {}); return; }
      const hls = new Hls({ maxBufferLength: 60, maxMaxBufferLength: 180, backBufferLength: 30, enableWorker: true });
      hlsRef.current = hls;
      hls.attachMedia(v);
      hls.loadSource(play);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setAudioTracks(hls.audioTracks.map((t: any, i: number) => ({
          id: String(i), label: t.name || t.lang || `Audio ${i + 1}`, apply: () => { hls.audioTrack = i; },
        })));
        v.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_e: any, d: any) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else failover();
      });
    };

    if (/\.m3u8(\?|$)/i.test(srcUrl)) startHls();
    else { v.src = play; v.load(); v.play().catch(() => {}); }
    return () => { cancelled = true; hlsRef.current?.destroy?.(); hlsRef.current = null; };
  }, [srcUrl, mode, ticket, audioSel, offset]);

  const failover = useCallback((why?: string) => {
    const v = vRef.current;
    const code = v?.error?.code;
    if (mode === 'direct' && attempt < 1) {
      setMsg('Stream link expired — fetching a fresh one…'); setStatus('loading'); setAttempt((a) => a + 1); return;
    }
    if (ffmpegOk && mode === 'direct') {
      setMsg('Your browser cannot decode this container/audio — converting on the fly…');
      setStatus('loading'); setMode('remux'); return;
    }
    if (ffmpegOk && mode === 'remux') {
      setMsg('Re-encoding video for full compatibility…'); setStatus('loading'); setMode('full'); return;
    }
    setStatus('error');
    setMsg(why || (code === 3 || code === 4
      ? `This release uses a codec your browser can't decode (usually HEVC/x265 video or AC3/DTS audio).${ffmpegOk ? '' : ' Install ffmpeg on the server for automatic conversion, or pick an H.264 source.'}`
      : 'The stream stopped responding. TorBox may still be caching this file.'));
  }, [mode, attempt, ffmpegOk]);

  /* ---------------------------- 3. media events ------------------------------ */
  useEffect(() => {
    const v = vRef.current; if (!v) return;
    const onMeta = () => {
      setDur(v.duration || 0); setStatus('ready');
      const at: any = (v as any).audioTracks;
      if (at && at.length > 1) {
        const list: Track[] = [];
        for (let i = 0; i < at.length; i++) {
          const t = at[i];
          list.push({
            id: String(i), label: t.label || t.language || `Audio ${i + 1}`,
            apply: () => { for (let k = 0; k < at.length; k++) at[k].enabled = k === i; },
          });
        }
        setAudioTracks(list);
        const active = [...Array(at.length).keys()].find((i) => at[i].enabled);
        if (active !== undefined) setAudioIdx(active);
      }
      if (modeRef.current === 'direct') {
        const prev = getProgressFor(req.key);
        if (prev && prev.time > 20 && prev.duration - prev.time > 60) v.currentTime = prev.time;
      } else if (offsetRef.current > 0) {
        v.play().catch(() => {});
      }
    };
    const onTime = () => {
      const base = modeRef.current === 'direct' ? 0 : offsetRef.current;
      setCur(base + v.currentTime);
      if (v.buffered.length) setBuf(base + v.buffered.end(v.buffered.length - 1));
    };
    const onErr = () => failover();
    const onPlaying = () => { setStatus('ready'); setPlaying(true); };
    const onPause = () => setPlaying(false);
    const onEnd = () => req.onNext?.();
    const onVol = () => { setVol(v.volume); setMuted(v.muted); };
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('progress', onTime);
    v.addEventListener('error', onErr);
    v.addEventListener('waiting', () => setMsg('Buffering…'));
    v.addEventListener('canplay', () => setStatus('ready'));
    v.addEventListener('playing', onPlaying);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnd);
    v.addEventListener('volumechange', onVol);
    return () => {
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('progress', onTime);
      v.removeEventListener('error', onErr);
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnd);
      v.removeEventListener('volumechange', onVol);
    };
  }, [failover, req]);

  useEffect(() => {
    const onFs = () => setFs(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  /* ----------------------------- 4. progress save ---------------------------- */
  useEffect(() => {
    const iv = setInterval(() => {
      const v = vRef.current;
      if (!v || !v.duration || v.paused) return;
      saveProgress({
        key: req.key, title: req.title, poster: req.poster, backdrop: req.backdrop,
        kind: req.kind, itemId: req.itemId, fileId: req.fileId, fileName: req.fileName,
        time: (modeRef.current === 'direct' ? 0 : offsetRef.current) + v.currentTime,
        duration: (modeRef.current === 'direct' ? v.duration : (probeRef.current?.duration || v.duration)),
        updated: Date.now(), sub: req.subtitle,
      });
    }, 5000);
    return () => clearInterval(iv);
  }, [req]);

  /* -------------------------------- 5. subtitles ------------------------------ */
  // sidecar files + tracks embedded in the container (via ffmpeg)
  const allSubs = useMemo<SubSource[]>(() => {
    const embedded: SubSource[] = (probe?.subs || []).map((x) => ({
      label: `${x.lang}${x.title ? ' · ' + x.title : ''} · embedded`,
      name: `embedded-${x.id}.vtt`,
      url: `embed:${x.id}`,
    }));
    return [...embedded, ...subSources];
  }, [probe, subSources]);

  useEffect(() => {
    const list: SubSource[] = (req.subFiles || []).map(({ file, item }) => ({
      label: `${guessSubLang(file.path || file.name)} · ${file.name}`,
      name: file.path || file.name,
      url: `/api/stream?kind=${item.kind || 'torrent'}&id=${item.id}&fileId=${file.id}`,
    }));
    setSubSources(list);
  }, [req.subFiles]);

  // choose sensible defaults once the full list (sidecar + embedded) is known
  const autoPicked = useRef('');
  useEffect(() => {
    const sig = allSubs.map((s) => s.url).join('|');
    if (!sig || autoPicked.current === sig) return;
    autoPicked.current = sig;
    const en = allSubs.find((s) => /english/i.test(s.label) && !/sdh/i.test(s.label)) || allSubs.find((s) => /english/i.test(s.label));
    const ur = allSubs.find((s) => /urdu/i.test(s.label));
    setSubA(en ? en.url : 'off');
    setSubB(ur ? ur.url : 'off');
  }, [allSubs]);

  const loadCues = async (u: string, set: (c: Cue[]) => void, name: string) => {
    if (!u || u === 'off') return set([]);
    try {
      if (u.startsWith('embed:')) {
        const r = await fetch(`/api/subtrack/${ticket}?s=${u.slice(6)}`);
        return set(parseAny(await r.text(), 'x.vtt'));
      }
      const meta = await fetch(u);
      const { ticket: tk } = await meta.json();
      const r = await fetch(`/api/subtitle?ticket=${encodeURIComponent(tk)}`);
      set(parseAny(await r.text(), name));
    } catch { set([]); }
  };
  useEffect(() => { loadCues(subA, setCuesA, allSubs.find((s) => s.url === subA)?.name || ''); }, [subA, allSubs, ticket]);
  useEffect(() => { loadCues(subB, setCuesB, allSubs.find((s) => s.url === subB)?.name || ''); }, [subB, allSubs, ticket]);
  useEffect(() => {
    setLineA(cuesA.length ? cueAt(cuesA, cur)?.text || '' : '');
    setLineB(cuesB.length ? cueAt(cuesB, cur)?.text || '' : '');
  }, [cur, cuesA, cuesB]);

  /* -------------------------------- 6. commands ------------------------------- */
  const totalDur = (mode !== 'direct' && probe?.duration) ? probe.duration : dur;

  /** Absolute seek that works in both direct and converted modes. */
  const seekTo = useCallback((abs: number) => {
    const v = vRef.current; if (!v) return;
    const total = (mode !== 'direct' && probe?.duration) ? probe.duration : (v.duration || 0);
    const target = Math.max(0, Math.min((total || 1) - 1, abs));
    if (mode === 'direct') { v.currentTime = target; return; }
    // converted stream: restart ffmpeg at the new offset
    const local = target - offset;
    if (local >= 0 && local < (v.duration || 0) - 1 && v.buffered.length && local <= v.buffered.end(v.buffered.length - 1)) {
      v.currentTime = local;                       // already buffered -> instant
    } else {
      setOffset(target);
      setStatus('loading');
      setMsg('Seeking…');
    }
  }, [mode, probe, offset]);

  const seekBy = useCallback((d: number) => {
    const v = vRef.current; if (!v) return;
    const abs = (mode === 'direct' ? 0 : offset) + v.currentTime + d;
    seekTo(abs);
    flash(`${d > 0 ? '+' : '−'}${Math.abs(d)}s`, 700); poke();
  }, [mode, offset, seekTo, poke]);

  const toggle = useCallback(() => {
    const v = vRef.current; if (!v) return;
    if (v.paused) { v.play().catch(() => {}); } else { v.pause(); }
    poke();
  }, [poke]);

  const setVolume = useCallback((n: number) => {
    const v = vRef.current; if (!v) return;
    const nv = Math.max(0, Math.min(1, n));
    v.volume = nv; v.muted = nv === 0; setVol(nv); setMuted(nv === 0);
    flash(`Volume ${Math.round(nv * 100)}%`, 700); poke();
  }, [poke]);

  /** Switch audio language. Direct playback can only expose tracks the browser
      itself demuxes, so anything else is served through ffmpeg with that track
      mapped in — the position is preserved via the virtual timeline. */
  const switchAudio = useCallback((id: number, silent = false) => {
    const v = vRef.current;
    const at = probe?.audio?.[id];
    const here = (offset || 0) + (v?.currentTime || 0);
    setAudioSel(id);
    if (at) localStorage.setItem('samis.audiolang', at.lang);
    setOffset(here > 2 ? here : 0);
    setMode((m) => (m === 'full' ? 'full' : 'remux'));
    setStatus('loading');
    setMsg(`Switching audio to ${at?.lang || 'track ' + (id + 1)}…`);
    if (!silent) flash(`Audio: ${at?.lang || id + 1}`, 1400);
  }, [probe, offset]);

  const cycleAudio = useCallback(() => {
    if (probe?.audio?.length > 1) {
      const cur = audioSel ?? Math.max(0, probe.audio.findIndex((a) => a.default));
      switchAudio((cur + 1) % probe.audio.length);
      return;
    }
    if (audioTracks.length < 2) { setPanel('audio'); return; }
    const n = (audioIdx + 1) % audioTracks.length;
    setAudioIdx(n); audioTracks[n].apply();
    flash(`Audio: ${audioTracks[n].label}`, 1400);
  }, [probe, audioSel, switchAudio, audioTracks, audioIdx]);

  const toggleFs = useCallback(() => {
    const el = wrapRef.current;
    if (!document.fullscreenElement) el?.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  }, []);

  /* --------------- 7. keyboard / D-pad (TV remote + PC keyboard) -------------- */
  const panelRef = useRef<HTMLDivElement>(null);
  const moveInPanel = (dir: 1 | -1) => {
    const opts = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[data-focus]') || []);
    if (!opts.length) return;
    const i = opts.findIndex((o) => o === document.activeElement);
    const n = i < 0 ? 0 : (i + dir + opts.length) % opts.length;
    opts[n].focus();
    opts[n].scrollIntoView({ block: 'nearest' });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      poke(Boolean(panel));
      // ---- panel navigation mode (D-pad friendly) ----
      if (panel) {
        switch (k) {
          case 'ArrowDown': e.preventDefault(); moveInPanel(1); return;
          case 'ArrowUp': e.preventDefault(); moveInPanel(-1); return;
          case 'ArrowLeft': case 'Backspace': case 'Escape': e.preventDefault(); setPanel(null); return;
          case 'ArrowRight': e.preventDefault(); return;
          case 'Enter': case ' ': {
            const el = document.activeElement as HTMLElement;
            if (el && panelRef.current?.contains(el)) { e.preventDefault(); el.click(); }
            return;
          }
        }
      }
      switch (k) {
        case 'ArrowRight': case 'MediaFastForward': e.preventDefault(); seekBy(10); break;
        case 'ArrowLeft': case 'MediaRewind': e.preventDefault(); seekBy(-10); break;
        case 'ArrowUp': e.preventDefault(); setPanel('audio'); break;
        case 'ArrowDown': e.preventDefault(); setPanel('subs'); break;
        case 'Enter': case ' ': case 'MediaPlayPause': case 'Pause': case 'Play':
          e.preventDefault(); toggle(); break;
        case 'Escape': case 'Backspace': case 'BrowserBack': case 'GoBack':
          e.preventDefault(); if (document.fullscreenElement) document.exitFullscreen?.(); else onClose(); break;
        case 'f': case 'F': toggleFs(); break;
        case 'm': case 'M': setVolume(muted ? 1 : 0); break;
        case '+': case '=': setVolume(vol + 0.1); break;
        case '-': setVolume(vol - 0.1); break;
        case 'c': case 'C': setPanel(panel === 'subs' ? null : 'subs'); break;
        case 'a': case 'A': cycleAudio(); break;
        case 'j': seekBy(-30); break;
        case 'l': seekBy(30); break;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [panel, seekBy, toggle, onClose, poke, muted, vol, setVolume, cycleAudio, toggleFs]);

  /* ----------------------- 8. mouse / touch on the scrubber ------------------- */
  const posFromEvent = (clientX: number) => {
    const el = barRef.current;
    const total = (mode !== 'direct' && probe?.duration) ? probe.duration : dur;
    if (!el || !total) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * total;
  };
  const onBarDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const t = posFromEvent(e.clientX);
    setScrub(t);
    const move = (ev: PointerEvent) => setScrub(posFromEvent(ev.clientX));
    const up = (ev: PointerEvent) => {
      const time = posFromEvent(ev.clientX);
      if (isFinite(time)) seekTo(time);
      setScrub(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      poke();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const lastTap = useRef(0);
  const onSurface = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.pctl, .ppanel')) return;
    const now = Date.now();
    if (now - lastTap.current < 280) { toggleFs(); lastTap.current = 0; return; }
    lastTap.current = now;
    setTimeout(() => { if (lastTap.current && Date.now() - lastTap.current >= 260) { toggle(); lastTap.current = 0; } }, 270);
  };
  const onWheel = (e: React.WheelEvent) => { setVolume(vol - Math.sign(e.deltaY) * 0.05); };

  const shown = scrub ?? cur;
  const totalShown = (mode !== 'direct' && probe?.duration) ? probe.duration : dur;
  const pct = totalShown ? (shown / totalShown) * 100 : 0;
  const bpct = totalShown ? Math.min(100, (buf / totalShown) * 100) : 0;

  const subStyle = useMemo(() => ({
    fontSize: `clamp(14px, ${style.size / 10}vw, ${style.size * 1.5}px)`,
    color: style.color,
    background: style.bg > 0 ? `rgba(0,0,0,${style.bg})` : 'transparent',
    padding: style.bg > 0 ? '.18em .55em' : 0,
    borderRadius: 8,
    textShadow: style.shadow ? '0 2px 6px rgba(0,0,0,.95)' : 'none',
    fontWeight: 600,
  }), [style]);

  const Btn = ({ onClick, title, children, big }: any) => (
    <button className={`pbtn ${big ? 'lg' : ''}`} data-focus onClick={onClick} title={title} aria-label={title}>{children}</button>
  );

  return (
    <div
      className={`player ${ui ? '' : 'hidecursor'}`}
      ref={wrapRef}
      onMouseMove={() => poke(Boolean(panel))}
      onTouchStart={() => poke(Boolean(panel))}
      onClick={onSurface}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <video ref={vRef} playsInline crossOrigin="anonymous" />

      {(lineA || lineB) && (
        <div className="subs" style={{ bottom: `${ui ? Math.max(style.pos, 16) : style.pos}%` }}>
          {lineA && <span className="subline" style={subStyle}>{lineA}</span>}
          {lineB && <span className="subline" style={{ ...subStyle, color: '#ffe9a8' }}>{lineB}</span>}
        </div>
      )}

      {status === 'loading' && (
        <div className="center">
          <div className="spin" />
          <div style={{ color: '#bdbdc4', fontSize: 13, textAlign: 'center', maxWidth: 420 }}>{msg}</div>
        </div>
      )}

      {status === 'error' && (
        <div className="center">
          <div className="glass" style={{ padding: 26, maxWidth: 520, textAlign: 'center' }}>
            <div style={{ color: '#ffb2b2', display: 'flex', justifyContent: 'center', marginBottom: 10 }}><IWarn /></div>
            <h3 style={{ margin: '0 0 8px' }}>Playback problem</h3>
            <p style={{ color: '#b9b9c0', fontSize: 13, lineHeight: 1.6 }}>{msg}</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn btn-gold" data-focus autoFocus
                onClick={() => { setMode('direct'); setAttempt((a) => a + 1); setStatus('loading'); }}>Retry</button>
              {ffmpegOk && <button className="btn btn-ghost" data-focus onClick={() => { setMode('full'); setStatus('loading'); }}>Force convert</button>}
              <button className="btn btn-ghost" data-focus onClick={onClose}>Back</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast glass">{toast}</div>}

      <div className={`pctl ${ui ? 'show' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="ptop">
          <Btn onClick={onClose} title="Back"><IArrowLeft /></Btn>
          <div className="ttl">
            {req.title}
            {req.subtitle ? <span style={{ color: '#9a9aa2', fontWeight: 500 }}> — {req.subtitle}</span> : null}
          </div>
          {probe?.audio?.length ? (
            <span className="tag gold">{probe.audio[audioSel ?? Math.max(0, probe.audio.findIndex((a) => a.default))]?.lang || 'AUDIO'}</span>
          ) : null}
          {mode !== 'direct' && <span className="tag">{mode === 'full' ? 'CONVERTING' : 'HD REMUX'}</span>}
        </div>

        <div className="pbot">
          <div className={`bar ${scrub !== null ? 'dragging' : ''}`} ref={barRef} onPointerDown={onBarDown}>
            <div className="buf" style={{ width: `${bpct}%` }} />
            <div className="cur" style={{ width: `${pct}%` }} />
            <div className="knob" style={{ left: `${pct}%` }} />
            {scrub !== null && <div className="scrubtip" style={{ left: `${pct}%` }}>{fmtTime(scrub)}</div>}
          </div>

          <div className="pbtns">
            <Btn big onClick={toggle} title={playing ? 'Pause' : 'Play'}>{playing ? <IPause size={22} /> : <IPlay size={22} />}</Btn>
            <Btn onClick={() => seekBy(-10)} title="Back 10 seconds"><IBack10 /></Btn>
            <Btn onClick={() => seekBy(10)} title="Forward 10 seconds"><IFwd10 /></Btn>
            {req.onNext && <Btn onClick={req.onNext} title="Next episode"><INext /></Btn>}
            <span className="time">{fmtTime(shown)} <span style={{ color: '#7b7b82' }}>/ {fmtTime(totalShown)}</span></span>

            <div className="volwrap">
              <Btn onClick={() => setVolume(muted ? 1 : 0)} title={muted ? 'Unmute' : 'Mute'}>{muted || vol === 0 ? <IMute /> : <IVol />}</Btn>
              <input className="vol" type="range" min={0} max={1} step={0.02} value={muted ? 0 : vol}
                onChange={(e) => setVolume(+e.target.value)} aria-label="Volume" />
            </div>

            <div style={{ flex: 1 }} />

            <Btn onClick={() => setPanel(panel === 'audio' ? null : 'audio')} title="Audio track (Up)">
              <span className="lbl">AUDIO</span>
            </Btn>
            <Btn onClick={() => setPanel(panel === 'subs' ? null : 'subs')} title="Subtitles (Down)">
              <span className="lbl">CC</span>
            </Btn>
            <Btn onClick={() => setPanel(panel === 'style' ? null : 'style')} title="Subtitle style">Aa</Btn>
            <Btn onClick={() => setPanel(panel === 'speed' ? null : 'speed')} title="Speed">
              <span className="lbl">{rate}×</span>
            </Btn>
            {ffmpegOk && mode === 'direct' && (
              <Btn onClick={() => { setMode('remux'); setStatus('loading'); }} title="No sound or stutter? convert this stream"><ICog /></Btn>
            )}
            <Btn onClick={toggleFs} title="Fullscreen">{fs ? <IExitFull /> : <IFull />}</Btn>
          </div>
        </div>

        {panel && (
          <div className="ppanel glass fadein" ref={panelRef} onClick={(e) => e.stopPropagation()}>
            <div className="phead">
              <h4>
                {panel === 'audio' ? 'Audio track' : panel === 'subs' ? 'Subtitles'
                  : panel === 'style' ? 'Subtitle style' : 'Playback speed'}
              </h4>
              <button className="pclose" data-focus onClick={() => setPanel(null)} title="Close"><IClose /></button>
            </div>

            {panel === 'audio' && (
              probe?.audio?.length ? (
                <>
                  {probe.audio.map((a) => {
                    const def = Math.max(0, probe.audio.findIndex((x) => x.default));
                    const active = (audioSel ?? def) === a.id;
                    return (
                      <button key={a.id} data-focus className={`opt ${active ? 'on' : ''}`}
                        onClick={() => switchAudio(a.id)}>
                        {active ? '●' : '○'} {a.lang}
                        <span style={{ color: '#8a8a92', fontSize: 11, marginLeft: 6 }}>
                          {a.codec?.toUpperCase()}{a.channels ? ` · ${a.channels === 6 ? '5.1' : a.channels === 8 ? '7.1' : a.channels + 'ch'}` : ''}
                        </span>
                      </button>
                    );
                  })}
                  {probe.audio.length > 1 && (
                    <p className="hint">Switching keeps your position. The chosen language is remembered for the next title.</p>
                  )}
                </>
              ) : audioTracks.length ? audioTracks.map((t, i) => (
                <button key={t.id} data-focus className={`opt ${i === audioIdx ? 'on' : ''}`}
                  onClick={() => { setAudioIdx(i); t.apply(); flash(`Audio: ${t.label}`); }}>
                  {i === audioIdx ? '●' : '○'} {t.label}
                </button>
              )) : (
                <p className="hint">
                  {probe && probe.ffprobe === false
                    ? <>Install <b>ffmpeg</b> on the server to list and switch embedded audio tracks (Hindi / Urdu / English).</>
                    : probe
                      ? <>This release has a single audio track. Pick a <b>Dual Audio</b> source in “Choose source” for Hindi + English.</>
                      : <>Reading the track list…</>}
                </p>
              )
            )}

            {panel === 'subs' && (
              <>
                <div className="sublabel">Primary</div>
                <button data-focus className={`opt ${subA === 'off' ? 'on' : ''}`} onClick={() => setSubA('off')}>Off</button>
                {allSubs.map((s) => (
                  <button key={'a' + s.url} data-focus className={`opt ${subA === s.url ? 'on' : ''}`} onClick={() => setSubA(s.url)}>{s.label}</button>
                ))}
                <div className="sublabel">Secondary (dual subtitles)</div>
                <button data-focus className={`opt ${subB === 'off' ? 'on' : ''}`} onClick={() => setSubB('off')}>Off</button>
                {allSubs.map((s) => (
                  <button key={'b' + s.url} data-focus className={`opt ${subB === s.url ? 'on' : ''}`} onClick={() => setSubB(s.url)}>{s.label}</button>
                ))}
                {!allSubs.length && <p className="hint">No subtitles in this release. Pick a source tagged <b>ESub</b> / <b>MSub</b>, or one with a subs folder.</p>}
              </>
            )}

            {panel === 'style' && (
              <>
                <div className="rowline">
                  <label>Size</label>
                  <button className="step" data-focus onClick={() => setStyle({ ...style, size: Math.max(16, style.size - 2) })}>−</button>
                  <span className="time" style={{ width: 34, textAlign: 'center' }}>{style.size}</span>
                  <button className="step" data-focus onClick={() => setStyle({ ...style, size: Math.min(64, style.size + 2) })}>+</button>
                </div>
                <div className="rowline">
                  <label>Colour</label>
                  {SUB_COLORS.map((c) => (
                    <button key={c} data-focus className={`swatch ${style.color === c ? 'on' : ''}`} style={{ background: c }}
                      onClick={() => setStyle({ ...style, color: c })} aria-label={c} />
                  ))}
                </div>
                <div className="rowline">
                  <label>Backdrop</label>
                  <button className="step" data-focus onClick={() => setStyle({ ...style, bg: Math.max(0, +(style.bg - 0.15).toFixed(2)) })}>−</button>
                  <span className="time" style={{ width: 34, textAlign: 'center' }}>{Math.round(style.bg * 100)}</span>
                  <button className="step" data-focus onClick={() => setStyle({ ...style, bg: Math.min(0.95, +(style.bg + 0.15).toFixed(2)) })}>+</button>
                </div>
                <div className="rowline">
                  <label>Height</label>
                  <button className="step" data-focus onClick={() => setStyle({ ...style, pos: Math.max(4, style.pos - 3) })}>↓</button>
                  <span className="time" style={{ width: 34, textAlign: 'center' }}>{style.pos}%</span>
                  <button className="step" data-focus onClick={() => setStyle({ ...style, pos: Math.min(40, style.pos + 3) })}>↑</button>
                </div>
                <button className="opt" data-focus onClick={() => setStyle({ ...style, shadow: !style.shadow })}>
                  {style.shadow ? '☑' : '☐'} Text shadow
                </button>
                <button className="opt" data-focus onClick={() => setStyle(DEFAULT_STYLE)}>↺ Reset to defaults</button>
              </>
            )}

            {panel === 'speed' && [0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
              <button key={r} data-focus className={`opt ${rate === r ? 'on' : ''}`}
                onClick={() => { const v = vRef.current; if (v) v.playbackRate = r; setRate(r); }}>
                {rate === r ? '●' : '○'} {r}× {r === 1 ? '(normal)' : ''}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
