/* Spatial navigation (D-pad / arrow keys) for Android TV, Google TV, TV boxes and keyboards.
   Any element with [data-focus] participates. Pure geometry — no library. */

type Dir = 'up' | 'down' | 'left' | 'right';

const isVisible = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && el.offsetParent !== null;
};

export function candidates(scope?: HTMLElement | null): HTMLElement[] {
  const root = scope || document;
  return Array.from(root.querySelectorAll<HTMLElement>('[data-focus]')).filter(isVisible);
}

export function focusFirst(scope?: HTMLElement | null) {
  const c = candidates(scope);
  const preferred = c.find((e) => e.dataset.focusDefault === 'true') || c[0];
  if (preferred) setFocus(preferred);
}

export function setFocus(el: HTMLElement) {
  document.querySelectorAll('.dpad').forEach((e) => e.classList.remove('dpad'));
  el.classList.add('dpad');
  el.focus({ preventScroll: true });
  const r = el.getBoundingClientRect();
  const pad = 90;
  // Horizontal: scroll the nearest scrollable track.
  let p: HTMLElement | null = el.parentElement;
  while (p) {
    if (p.scrollWidth > p.clientWidth + 4) {
      const pr = p.getBoundingClientRect();
      if (r.left < pr.left + pad) p.scrollBy({ left: r.left - pr.left - pad, behavior: 'smooth' });
      else if (r.right > pr.right - pad) p.scrollBy({ left: r.right - pr.right + pad, behavior: 'smooth' });
      break;
    }
    p = p.parentElement;
  }
  // Vertical: page scroll.
  const vh = window.innerHeight;
  if (r.top < 140) window.scrollBy({ top: r.top - 160, behavior: 'smooth' });
  else if (r.bottom > vh - 80) window.scrollBy({ top: r.bottom - vh + 110, behavior: 'smooth' });
}

export function move(dir: Dir, scope?: HTMLElement | null) {
  const list = candidates(scope);
  if (!list.length) return false;
  const cur = (document.querySelector('.dpad') as HTMLElement) || null;
  if (!cur || !list.includes(cur)) { setFocus(list[0]); return true; }

  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const el of list) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const dx = bx - ax, dy = by - ay;
    const okDir =
      dir === 'left' ? b.right <= a.left + 4 :
      dir === 'right' ? b.left >= a.right - 4 :
      dir === 'up' ? b.bottom <= a.top + 4 :
      b.top >= a.bottom - 4;
    if (!okDir) continue;
    const primary = Math.abs(dir === 'left' || dir === 'right' ? dx : dy);
    const cross = Math.abs(dir === 'left' || dir === 'right' ? dy : dx);
    const score = primary + cross * 2.6; // strongly prefer the same row/column
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) { setFocus(best); return true; }
  return false;
}

/** Attach global D-pad handling. Returns a detach fn. */
export function installSpatial(opts: {
  onBack?: () => void;
  scope?: () => HTMLElement | null;
  intercept?: (key: string) => boolean; // return true if handled (e.g. player)
}) {
  const handler = (e: KeyboardEvent) => {
    const k = e.key;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (k === 'Escape') (e.target as HTMLElement).blur();
      return;
    }
    if (opts.intercept?.(k)) { e.preventDefault(); return; }

    const map: Record<string, Dir> = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    };
    if (map[k]) {
      if (move(map[k], opts.scope?.())) e.preventDefault();
      return;
    }
    if (k === 'Enter' || k === ' ') {
      const cur = document.querySelector('.dpad') as HTMLElement | null;
      if (cur) { e.preventDefault(); cur.click(); }
      return;
    }
    if (k === 'Backspace' || k === 'Escape' || k === 'GoBack' || k === 'BrowserBack') {
      e.preventDefault(); opts.onBack?.();
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
