# Building the Sami's Streaming APK

Everything needed is already in this project: the Android app (`android/`), the Capacitor config,
and the GitHub Actions workflow (`.github/workflows/android.yml`). You do **not** need Android
Studio — GitHub builds the APK for you in about 5 minutes.

---

## How the app is split (read this first — 30 seconds)

| Part | Where it runs |
|---|---|
| **The UI** (everything you see) | Inside the APK, bundled. Works offline until it needs data. |
| **The server** (`server/index.js`) | On a computer that stays on: your PC, a mini-PC, a NAS, or a cheap VPS. It holds your TorBox + TMDB keys and talks to TorBox. |

A phone cannot run Node.js, and your API keys must never be baked into an APK (anyone can unzip
one). So the APK asks, on first launch, for the address of your server — and remembers it.
That is the **Connect to your server** screen.

> Want to see that screen right now, in your browser? Open <http://localhost:5173/?setup=1>.

---

## Route A — GitHub Actions (recommended, no tools to install)

1. **Push this project to GitHub** (a private repo is fine).

   ```bash
   cd samis-streaming
   git init && git add . && git commit -m "Sami's Streaming"
   git branch -M main
   git remote add origin https://github.com/<you>/samis-streaming.git
   git push -u origin main
   ```

   `.gitignore` already keeps `.env` (your keys) and `node_modules` out of the repo. **Check that
   `.env` is not in the push** — the workflow does not need it, the APK does not need it.

2. **Run the workflow.** GitHub → your repo → **Actions** → **Android APK** → **Run workflow** →
   green button. (It also runs automatically when you push a tag like `v1.0`.)

3. **Download the APK.** When the run turns green, open it and scroll to **Artifacts** →
   `samis-streaming-apk`. Inside is `debug/app-debug.apk`.

4. **Install it.**
   - **Phone:** copy the APK over, tap it, allow "install unknown apps".
   - **Android TV / Google TV:** easiest is the *Downloader* app (AFTV) or
     `adb install app-debug.apk` from a PC on the same network.

5. **First launch:** type your server address, e.g. `192.168.1.20:8787`, press **Connect**.
   You should see `Connected — TorBox ✓ · TMDB ✓ · ffmpeg ✓` and then your library.
   Change it later any time with the **SERVER** chip in the header.

### Already downloaded a workflow file from somewhere?

You don't need it — `.github/workflows/android.yml` in this project is the one tailored to this
app (it builds the web bundle, runs `npx cap sync`, then Gradle). If you still want to use yours,
drop it in `.github/workflows/` next to mine; GitHub runs every file in that folder. Just make sure
it does `npm ci` → `npm run build` → `npx cap sync android` → `./gradlew assembleDebug` in
`android/`, in that order — skipping the sync step produces an APK with a blank screen.

### Optional: a signed release APK

Debug APKs install fine but expire-ish and can't go on Play. To get a signed release build, create
a keystore once:

```bash
keytool -genkey -v -keystore samis.jks -keyalg RSA -keysize 2048 -validity 10000 -alias samis
base64 -w0 samis.jks     # copy the output
```

Then in GitHub → Settings → **Secrets and variables → Actions**, add:

| Secret | Value |
|---|---|
| `KEYSTORE_B64` | the base64 blob above |
| `KEYSTORE_PASSWORD` | keystore password |
| `KEY_ALIAS` | `samis` |
| `KEY_PASSWORD` | key password |

Re-run the workflow — the artifact now also contains `samis-streaming-release.apk`.

---

## Route B — build it on your own machine

Requires **JDK 17+** and the **Android SDK** (Android Studio installs both).

```bash
npm install
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
# -> android/app/build/outputs/apk/debug/app-debug.apk
```

Or open the `android/` folder in Android Studio and press Run.

**Re-run `npm run build && npx cap sync android` after every change to the UI** — that is the step
that copies `dist/` into the app.

---

## Keeping the server running

Any of these work; pick one:

- **PC / mini-PC on your LAN** — `npm start`, then use its LAN IP. Simplest, free, but the PC must
  be awake while you watch.
- **Always-on box / NAS** — same thing under `pm2 start server/index.js --name samis` or a systemd
  unit, so it survives reboots.
- **VPS with HTTPS** (fly.io, Railway, a €4 VPS + Caddy) — then the app works outside your home
  too, and you enter the `https://…` URL instead. Put your `TMDB_API_KEY` / `TORBOX_API_KEY` in the
  host's environment variables, never in the repo.

The server listens on `PORT` (default **8787**) and already sends the CORS headers the APK needs.
If the app can't reach it, check: same Wi-Fi, correct IP, and the firewall allows inbound 8787
(Windows Defender asks the first time — click *Allow*).

---

## Android TV specifics (already configured)

- `LEANBACK_LAUNCHER` category, so it appears on the TV home row.
- Touchscreen declared *not required*, leanback *not required* → one APK for phone **and** TV.
- Cleartext HTTP allowed, so a plain `http://192.168.x.x:8787` server works.
- Hardware acceleration on; the whole UI is D-pad navigable (gold focus ring) and the player maps
  ←/→ to seek, ↑ to audio, ↓ to subtitles, OK to play/pause, Back to exit.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Blank white/black screen after install | `npx cap sync android` wasn't run after `npm run build` |
| "No answer" on the connect screen | wrong IP, server not started, or firewall blocking 8787 |
| Connects, but no cloud items | the server's `.env` is missing `TORBOX_API_KEY` |
| Video plays but no sound on some titles | install ffmpeg on the **server** and restart it |
| Gradle fails in Actions with a Java error | the workflow pins JDK 21; don't downgrade it |
