/* Inline SVG icon set — emoji glyphs are missing from many Android TV / TV-box
   system fonts and render as tofu boxes, so the UI never uses them. */
const S = ({ children, size = 20 }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

export const IPlay = ({ size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>;
export const IPause = ({ size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="3.6" height="14" rx="1.2" /><rect x="13.9" y="5" width="3.6" height="14" rx="1.2" /></svg>;
export const IBack10 = ({ size = 20 }) => <S size={size}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><text x="12" y="15.5" fontSize="7" fill="currentColor" stroke="none" textAnchor="middle" fontWeight="700">10</text></S>;
export const IFwd10 = ({ size = 20 }) => <S size={size}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /><text x="12" y="15.5" fontSize="7" fill="currentColor" stroke="none" textAnchor="middle" fontWeight="700">10</text></S>;
export const INext = ({ size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 5.5v13l10-6.5z" /><rect x="16.5" y="5" width="2.8" height="14" rx="1.1" /></svg>;
export const IVol = ({ size = 20 }) => <S size={size}><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7" /><path d="M19 6a8.5 8.5 0 0 1 0 12" /></S>;
export const IMute = ({ size = 20 }) => <S size={size}><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="m17 9 4 6M21 9l-4 6" /></S>;
export const IFull = ({ size = 20 }) => <S size={size}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></S>;
export const IExitFull = ({ size = 20 }) => <S size={size}><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></S>;
export const IArrowLeft = ({ size = 20 }) => <S size={size}><path d="M19 12H5M12 19l-7-7 7-7" /></S>;
export const ICog = ({ size = 20 }) => <S size={size}><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1 2 2 0 1 1-4 0 1.6 1.6 0 0 0-2.7-1.1l-.1.1A2 2 0 1 1 4.6 17l.1-.1A1.6 1.6 0 0 0 3.6 14a2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.1-2.7l-.1-.1A2 2 0 1 1 7.4 4.4l.1.1A1.6 1.6 0 0 0 10 3.6a2 2 0 1 1 4 0 1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 20.4 10a2 2 0 1 1 0 4 1.6 1.6 0 0 0-1 1z" /></S>;
export const ISearch = ({ size = 18 }) => <S size={size}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></S>;
export const IRefresh = ({ size = 16 }) => <S size={size}><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></S>;
export const IClose = ({ size = 16 }) => <S size={size}><path d="M18 6 6 18M6 6l12 12" /></S>;
export const IWarn = ({ size = 28 }) => <S size={size}><path d="M12 3 2 20h20L12 3z" /><path d="M12 9v5M12 17.5v.01" /></S>;
export const ICheck = ({ size = 16 }) => <S size={size}><path d="m20 6-11 11-5-5" /></S>;
