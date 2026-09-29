# Sami's Streaming

A minimalist, Netflix-style streaming app built on **TMDB** (catalogue) + **TorBox** (delivery).
Browse *everything* — Turkish, Hindi, English and English-dubbed movies & series — press Play, and
the title is pushed into your TorBox cloud and streamed in the built-in player. No external player,
no manual torrent handling.

Runs on Web/PC, mobile browsers, and Android TV / Google TV / TV boxes (full D-pad), with mouse,
touch and remote all supported.

---

## 1. Keys (already configured)

`.env` in this folder — git-ignored, never bundled, never sent to the browser:

```ini
TMDB_API_KEY=…            # yours is set
TORBOX_API_KEY=…          # yours is set
TORBOX_API_BASE=https://api.torbox.app/v1
PORT=8787
# DIRECT_STREAM=true      # optional: hand raw CDN urls to the browser (faster, but the url carries your token)
# FFMPEG_PATH=ffmpeg      # optional: path override for the converter
```

## 2. Run

```bash
npm install
npm run dev       # dev:  API :8787 + UI :5173
npm run serve     # prod: build + single server on :8787
```

Header shows `TB ✓  DB ✓  FF ✓/–` (TorBox / TMDB / ffmpeg).

## 3. Install ffmpeg (strongly recommended)

```bash
sudo apt install ffmpeg      # Linux
brew install ffmpeg          # macOS
winget install Gyan.FFmpeg   # Windows
```

Browsers cannot decode AC3/DTS/TrueHD audio, and HEVC only with a hardware decoder. When ffmpeg is
present the server remuxes those files to fragmented MP4 + AAC on the fly (video is *copied*, so the
CPU cost is tiny) — the app detects it at boot and uses it automatically. Without it, the source
ranker still prefers H.264/AAC releases that play natively.

---

## How it works

**Catalogue (everything, not just your cloud).** Home has Trending Turkish Series, Turkish Movies,
Hindi Hits, Hindi Series, Hollywood English, English Series, English Dubbed and Top Rated rows.
**Movies** / **Series** pages add language tabs (Turkish · Hindi · English · English Dubbed),
every TMDB genre, three sort orders and infinite scroll. Search covers your cloud *and* all of TMDB.

**Play = auto-add.** Pressing Play on any title:

1. queries the indexers — TorBox Search, The Pirate Bay, Knaben, BitSearch — in parallel;
2. asks TorBox which hashes are **already cached** (instant) and what files they contain;
3. ranks: cached ≫ H.264/AAC (plays natively) ≫ 1080p ≫ sane size ≫ language match ≫ seeders,
   with CAM/remux/HEVC-DTS penalised;
4. adds the winner to your cloud (`createtorrent`), waits for the file list (instant for cached),
5. picks the correct file inside a season pack (S02E07 aware) and streams it.

Measured end-to-end on your account: **≈12 s from click to picture** for a cached title.
**Choose source** shows the full ranked list (INSTANT / DOWNLOAD, quality, codec, “plays direct” vs
“needs convert”, seeders, size, audio languages) and accepts a pasted magnet or info-hash.

**Your cloud.** Everything in TorBox — torrents, usenet, web downloads — is parsed, grouped into
series/seasons/episodes, language-tagged and matched to TMDB art. Raw per-file access lives in
**My Cloud**; games/`.exe` payloads are kept out of the library.

**Player.** Hardware-accelerated `<video>` (hls.js loaded only for HLS), deep forward buffer, resume
position, and a failure chain that never crashes: *fresh link → ffmpeg remux → ffmpeg re-encode →
error card with Retry / Force convert*. Signed CDN urls (which contain your token) never reach the
browser — the player only sees `/api/play/<uuid>`.

**Audio (Netflix-style language picker).** As soon as a title opens, the server runs `ffprobe`
through its own proxy and reports every embedded track by real language name — *Hindi AAC 5.1*,
*English AAC 5.1*, *Urdu*, … Pick one in the AUDIO panel (or press `A` / ↑ on a remote) and the
stream is re-served by ffmpeg with that track mapped in, **video copied, not re-encoded**, so the
switch is cheap and your position carries over. Because the converted stream restarts at zero, the
player keeps a *virtual timeline*: the real duration comes from the probe and seeking simply
restarts the conversion at the new timestamp (anything already buffered seeks instantly). Your
chosen language is remembered and auto-selected on the next title.

**Subtitles.** Sidecar `.srt/.vtt/.ass/.ssa` files **plus subtitle tracks embedded in the MKV**
(extracted to WebVTT on the fly) appear in one list. **Two tracks can be shown at once**
(English + Urdu auto-paired), with size, colour, backdrop opacity, vertical position and shadow —
all persisted.

**No waiting.** A cached add returns its file list in the same response as the add itself
(≈0.5 s measured), so there is no polling at all for instant copies; uncached ones poll at 400 ms
and back off. Measured cold start on a cached title: **~1 second from pressing Play to picture.**
The “opening…” overlay is fully cancellable — Cancel, Esc, TV Back or clicking outside aborts the
request for good and cannot reappear.

### Controls

| | Remote / keyboard | Mouse | Touch |
|---|---|---|---|
| Play / pause | OK · Enter · Space | click video | tap |
| Seek ±10s | ← / → | drag the scrubber | drag |
| Audio panel | ↑ (or `A` to cycle) | AUDIO button | tap |
| Subtitle panel | ↓ (or `C`) | CC button | tap |
| Panels | ↑/↓ move · OK select · ← close | click | tap |
| Volume | `+` / `−` / `M` | wheel or slider | slider |
| Fullscreen | `F` | double-click | — |
| Back | Back · Esc · Backspace | ← button | ← button |

Outside the player, arrow keys drive true spatial navigation (gold focus ring, auto-scroll) so a
bare TV remote operates the entire app.

---

## Verified (headless Chrome, against your live account)

| Test | Result |
|---|---|
| **Audio switching** (Top Gun DS4K, dual audio) | panel listed `Hindi AAC 5.1` + `English AAC 5.1`; switching reloaded `…/api/transcode/<t>?mode=remux&a=1&t=10`, kept the position (9.9 s → 0:23) and full 2:12:37 duration, still playing, 0 errors |
| **Embedded subtitles** | `English · embedded` + `English · SDH · embedded` offered on both primary and secondary slots |
| **Cancel while opening** | overlay dismissed instantly and stayed closed (+0.5/2/4/7 s re-checked) |
| **Time to picture** (cached) | **1.0 s** from Play to `<video>` playing |
| Home / Movies / Series / My Cloud / Search | 13 rows, 236 cards, **0 console or network errors** |
| Language tabs + genres + infinite scroll | 40 → 60 cards on scroll, all tabs populate |
| TMDB → source → auto-add → play (Inception) | picked cached YIFY H.264, played 1920×800, `readyState 4` |
| Cloud playback (Top Gun, x265 MKV) | played, seek OK, 2:12:39 duration parsed |
| Subtitles (American Sniper, 12 × .srt) | English track rendered on screen at t=608 s |
| Player controls | pause/seek/panels/speed 1.5×/scrub-drag/wheel/Esc — all pass |
| D-pad only, 1920×1080 | focus ring moves, Enter opens, Backspace returns |
| Mobile 390×844 | 0 px horizontal overflow |
| Production server | SPA, deep links, assets, API all 200 |

**Footprint:** source 325 KB + `dist` 872 KB + production `node_modules` 4.5 MB ≈ **5.7 MB** (limit 120 MB).
First paint ships 266 KB JS; the 576 KB hls.js chunk loads only for HLS streams.

## Known limits (honest list)

- **Audio switching needs ffmpeg on the server** (`FF ✓` in the header). Without it the player
  still plays, but only tracks the browser itself exposes can be selected.
- **Torrentio is wired in** as an extra IMDb-keyed indexer (great for Hindi/Turkish). Cloudflare
  403s this sandbox's datacentre IP, so I could not verify it from here — it should light up on
  your own network. MediaFusion was evaluated and **dropped**: its public instance returned zero
  streams even with a valid encrypted TorBox config.
- **Turkish coverage depends on TorBox Search.** This sandbox can only reach The Pirate Bay, which
  barely indexes Turkish TV, so `Kuruluş Osman` returned 0 sources *here*. TorBox Search, Knaben and
  BitSearch are wired in and will resolve from your own network — if a title still comes up empty,
  use *Choose source → paste magnet*.
- **Online Urdu subtitle search** needs a provider key (OpenSubtitles/SubDL). Right now Urdu subs
  come from the release itself — the ranker boosts `ESub`/`MSub`/Urdu-tagged sources. Say the word
  and I'll wire a provider in.
- **Money Heist episode titles** show as “Episode N”: TMDB only lists 3 seasons for it while your
  packs are Netflix parts 4–5, so there is nothing to map to. Playback is unaffected.
- Testing added **Inception (2010) 1080p YIFY** to your cloud (that was a real Play action). Delete
  it in My Cloud if you don't want it.

## Android / Android TV packaging

The Capacitor project (`android/`) and a ready GitHub Actions workflow
(`.github/workflows/android.yml`) are committed. Push to GitHub → **Actions → Android APK → Run
workflow** → download the APK artifact. Full walkthrough, signing and hosting options:
**[ANDROID.md](ANDROID.md)**.

Locally (needs JDK 17+ and the Android SDK):

```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug     # app/build/outputs/apk/debug/app-debug.apk
```

The APK bundles the UI but **not** your keys: on first launch it asks for the address of the
machine running `npm start` (e.g. `192.168.1.20:8787`), verifies it against `/api/health`, and
remembers it — change it later with the **SERVER** chip in the header. Preview that screen in a
browser with `?setup=1`. The manifest already declares `LEANBACK_LAUNCHER`, optional touchscreen,
cleartext HTTP and hardware acceleration, so one APK covers phone, tablet and Android TV.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `TB ✗` / `DB ✗` | key missing in `.env` → set, restart |
| Plays but no sound | AC3/DTS audio → press the ⚙ button (needs ffmpeg) |
| “codec your browser can't decode” | install ffmpeg, or **Choose source** → a `plays direct` H.264 release |
| “still downloading” | the chosen source wasn't cached; it appears in My Cloud when TorBox finishes |
| No sources for a title | paste a magnet in **Choose source**, or try the romanised title |
