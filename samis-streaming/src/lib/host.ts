/* Where the Sami's Streaming backend lives.
   On the web the UI is served by that same backend, so relative URLs work.
   Inside the Android / Android TV APK the UI is bundled in the app, so it has
   to be told the address of the machine running `npm start`. */

const KEY = 'samis.server';

/** True when running inside the Capacitor WebView (APK), not a browser tab. */
export const isNative = (): boolean =>
  typeof window !== 'undefined' &&
  (location.protocol === 'capacitor:' ||
    location.protocol === 'file:' ||
    Boolean((window as any).Capacitor?.isNativePlatform?.()));

/** Normalise whatever the user typed into a usable origin. */
export function normalizeServer(raw: string): string {
  let v = String(raw || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  v = v.replace(/\/+$/, '');
  // a bare host gets the default API port
  try {
    const u = new URL(v);
    if (!u.port && u.protocol === 'http:' && /^(\d{1,3}\.){3}\d{1,3}$/.test(u.hostname)) u.port = '8787';
    return u.origin;
  } catch { return ''; }
}

export const getServer = (): string =>
  (typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) || '';

export const setServer = (v: string) => {
  const n = normalizeServer(v);
  if (n) localStorage.setItem(KEY, n); else localStorage.removeItem(KEY);
  return n;
};

/** Absolute URL for an API path — the single place that knows about the host. */
export function apiUrl(path: string): string {
  if (!path.startsWith('/api')) return path;
  const base = isNative() ? getServer() : '';
  return base ? base + path : path;
}

/** Check a candidate server before we commit to it. */
export async function pingServer(origin: string, ms = 6000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${origin}/api/health`, { signal: ctl.signal });
    const j = await r.json();
    return j?.ok ? { ok: true as const, health: j } : { ok: false as const, error: 'That server answered, but not like Sami’s Streaming.' };
  } catch (e: any) {
    return { ok: false as const, error: e?.name === 'AbortError' ? 'No answer — check the address and that the server is running.' : String(e?.message || e) };
  } finally { clearTimeout(t); }
}

/** Rewrite every relative /api call so the APK reaches the configured server. */
export function installApiBase() {
  if (!isNative()) return;
  const orig = window.fetch.bind(window);
  const appOrigin = location.origin;               // capacitor://localhost etc.

  /** Map any URL that points at the app's own /api to the real server. */
  const remap = (u: string): string => {
    const base = getServer();
    if (!base) return u;
    if (u.startsWith('/api')) return base + u;
    if (u.startsWith(appOrigin + '/api')) return base + u.slice(appOrigin.length);
    if (u.startsWith('file:///api')) return base + u.slice('file://'.length);
    return u;
  };

  window.fetch = ((input: any, init?: any) => {
    if (typeof input === 'string') return orig(remap(input), init);
    if (input instanceof URL) return orig(remap(input.toString()), init);
    if (input instanceof Request) {
      const mapped = remap(input.url);
      return orig(mapped === input.url ? input : new Request(mapped, input), init);
    }
    return orig(input, init);
  }) as typeof fetch;
}
