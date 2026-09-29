export type Cue = { start: number; end: number; text: string };

const t2s = (t: string) => {
  const m = t.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/);
  if (!m) return 0;
  return (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] + +m[4] / (m[4].length === 2 ? 100 : 1000);
};

export function parseVTT(raw: string): Cue[] {
  const body = raw.replace(/\r/g, '').replace(/^WEBVTT.*?\n/, '');
  const cues: Cue[] = [];
  for (const block of body.split(/\n{2,}/)) {
    const lines = block.split('\n').filter(Boolean);
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti === -1) continue;
    const [a, b] = lines[ti].split('-->');
    const text = lines.slice(ti + 1).join('\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\{\\[^}]+\}/g, '')
      .trim();
    if (!text) continue;
    cues.push({ start: t2s(a), end: t2s(b), text });
  }
  return cues.sort((x, y) => x.start - y.start);
}

/** ASS/SSA → cues (TorBox packs often ship .ass). */
export function parseASS(raw: string): Cue[] {
  const cues: Cue[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('Dialogue:')) continue;
    const parts = line.slice(9).split(',');
    if (parts.length < 10) continue;
    const text = parts.slice(9).join(',')
      .replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').trim();
    if (!text) continue;
    cues.push({ start: t2s(parts[1]), end: t2s(parts[2]), text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function parseAny(raw: string, name = ''): Cue[] {
  if (/\.(ass|ssa)$/i.test(name) || raw.includes('[Script Info]')) return parseASS(raw);
  return parseVTT(raw);
}

export const cueAt = (cues: Cue[], t: number) => {
  // binary search
  let lo = 0, hi = cues.length - 1, found: Cue | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cues[mid];
    if (t < c.start) hi = mid - 1;
    else if (t > c.end) lo = mid + 1;
    else { found = c; break; }
  }
  return found;
};

export const guessSubLang = (name: string): string => {
  const n = name.toLowerCase();
  if (/\b(urdu|urd|\.ur\.)/.test(n)) return 'Urdu';
  if (/\b(hindi|hin|\.hi\.)/.test(n)) return 'Hindi';
  if (/\b(turkish|tur|turkce|türkçe|\.tr\.)/.test(n)) return 'Turkish';
  if (/\b(arabic|ara|\.ar\.)/.test(n)) return 'Arabic';
  if (/\b(english|eng|\.en\.)/.test(n)) return 'English';
  return 'Subtitle';
};
