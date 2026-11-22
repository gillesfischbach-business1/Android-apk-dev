# Schueberfouer 2026 – Android-App

Dieser Ordner verpackt das Browser-Spiel **Schueberfouer 2026** (three.js r170, ES-Module)
als **Android-App** mit [Capacitor 8](https://capacitorjs.com/). Das komplette Spiel
(HTML, JavaScript, Texturen, Modelle, three.js, Schriften) steckt in der APK/AAB –
die App läuft **vollständig offline**, schon beim ersten Start.

- Paket-ID: `lu.schueberfouer.game` · App-Name: `Schueberfouer 2026`
- Querformat (`sensorLandscape`), Vollbild (sticky immersive), Bildschirm bleibt an
- Zurück-Taste = Esc (Menü schließen / Pause), auf dem Titelbildschirm: App beenden
- App im Hintergrund → Pausemenü + Ton aus; zurück → Ton wieder an
- Kurzes Vibrieren bei Autoscooter-Zusammenstößen

## Ordnerstruktur

| Pfad | Inhalt |
|---|---|
| `www/` | Web-Bundle der App (wird von `sync-web` erzeugt und **ist eingecheckt**, damit CI ohne Spiel-Quellen bauen kann) |
| `www/native-bridge.js` | Android-Anbindung (Zurück-Taste, Pause, Haptik, Splash). Gehört zu diesem Repo, wird von `sync-web` nicht überschrieben |
| `scripts/sync-web.mjs` | Kopiert das Spiel nach `www/`, vendort three.js und Schriften, prüft auf CDN-URLs |
| `scripts/make-icons.py` | Zeichnet Icon- und Splash-Vorlagen nach `resources/` (Python + Pillow) |
| `resources/` | Icon (1024²) und Splash (2732²) als Quelle für `@capacitor/assets` |
| `android/` | Natives Android-Projekt (Gradle) |
| `capacitor.config.json` | Capacitor-Konfiguration |

## Voraussetzungen

| Werkzeug | Version |
|---|---|
| Node.js | ≥ 22 |
| JDK | 21 (Temurin/OpenJDK) |
| Android SDK | `platform-tools`, `platforms;android-36`, `build-tools;35.0.0` |
| Gradle | Wrapper 8.14.3 (wird von `./gradlew` geladen), AGP 8.13.0 |

Android SDK ohne Android Studio installieren (Linux):

```bash
export ANDROID_HOME=/opt/android-sdk
mkdir -p $ANDROID_HOME/cmdline-tools && cd /tmp
curl -fLO https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip
unzip -q commandlinetools-linux-16111833_latest.zip -d $ANDROID_HOME/cmdline-tools
mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest
export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH
yes | sdkmanager --licenses >/dev/null
sdkmanager "platform-tools" "platforms;android-36" "build-tools;35.0.0"
```

Lokal zusätzlich `android/local.properties` mit `sdk.dir=/opt/android-sdk` anlegen
(oder `ANDROID_HOME` exportieren). Die Datei ist gitignored.

## Spiel neu synchronisieren

Wenn sich das Spiel ändert:

```bash
npm ci
npm run sync:web                       # Standard-Quelle: /home/user/game-studio/prototypes/schueberfouer
# oder: node scripts/sync-web.mjs --game /pfad/zum/spiel
npx cap sync android                   # www/ -> android/app/src/main/assets/public
```

`sync-web` macht Folgendes (beliebig oft wiederholbar):

1. löscht `www/` (außer `native-bridge.js`) und kopiert `index.html`, `js/`, `assets/` aus dem Spiel;
2. kopiert `three/build/three.module.js` und **nur die von `js/` tatsächlich importierten
   `examples/jsm`-Module samt Abhängigkeiten** nach `www/vendor/three/`
   (`--full-jsm` kopiert den kompletten `examples/jsm`-Baum, ~14 MB);
3. schreibt die Importmap auf `./vendor/three/build/three.module.js` und `./vendor/three/examples/jsm/` um;
4. ersetzt den Google-Fonts-`<link>` durch `fonts.css` mit lokalen woff2-Dateien aus
   `@fontsource` (Bungee, Creepster, Nunito 400/700/900, Oswald 300–700; latin + latin-ext);
5. ergänzt `viewport-fit=cover` und bindet `native-bridge.js` vor `js/main.js` ein;
6. **bricht mit Exit-Code 1 ab**, wenn in `www/` noch `cdn.jsdelivr`, `googleapis` oder `gstatic`
   vorkommt oder ein `three/addons`-Import fehlt. Nur prüfen: `npm run check:web`.

## Bauen

Speicher schonen: `android/gradle.properties` setzt `-Xmx2g`, `org.gradle.workers.max=2` und
keinen Daemon. Immer nur **einen** Gradle-Build gleichzeitig starten.

```bash
cd android
./gradlew --no-daemon assembleDebug    # -> app/build/outputs/apk/debug/app-debug.apk
./gradlew --no-daemon bundleRelease    # -> app/build/outputs/bundle/release/app-release.aab
```

`VERSION_CODE` (Ganzzahl) und `VERSION_NAME` können per Umgebungsvariable gesetzt werden;
für jeden Play-Upload muss `VERSION_CODE` steigen.

## Signieren (Release)

Der Schlüssel wird **nie** eingecheckt (`*.jks`, `*.keystore`, `keystore.properties` sind gitignored).
`app/build.gradle` liest ihn nur aus Umgebungsvariablen:

| Variable | Bedeutung |
|---|---|
| `KS_FILE` | absoluter Pfad zur Upload-Keystore-Datei (`.jks`) |
| `KS_PASS` | Keystore-Passwort |
| `KS_ALIAS` | Alias (Standard `upload`) |
| `KEY_PASS` | Schlüssel-Passwort (Standard = `KS_PASS`) |

Ohne `KS_FILE` entsteht eine **unsignierte** AAB (Gradle warnt), die Play nicht annimmt.

Upload-Schlüssel einmalig erzeugen (außerhalb des Repos aufbewahren und sichern!):

```bash
keytool -genkeypair -v -keystore ~/keys/upload-keystore.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias upload -dname "CN=Schueberfouer 2026, C=LU"
export KS_FILE=~/keys/upload-keystore.jks KS_PASS=... KEY_PASS=...
cd android && ./gradlew --no-daemon bundleRelease
```

Für Google Play „Play App Signing“ aktivieren: Google signiert die ausgelieferten APKs,
dieser Schlüssel ist dann nur der **Upload-Schlüssel**.

## Installieren per adb

Auf dem Handy: Entwickleroptionen → USB-Debugging an, per USB verbinden.

```bash
adb devices
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n lu.schueberfouer.game/.MainActivity
adb logcat | grep -iE "Capacitor|chromium|Console"   # JS-Konsole/Fehler
```

Die Debug-APK erlaubt Remote-Debugging: in Chrome am PC `chrome://inspect` öffnen.
Eine AAB lokal testen: mit `bundletool build-apks --mode=universal ...` eine APK daraus erzeugen.

## Icons & Splash

```bash
python3 scripts/make-icons.py   # zeichnet resources/icon-*.png und resources/splash.png
npm run assets                  # @capacitor/assets 4.0.0 -> android/app/src/main/res (adaptive Icons + Splash)
```

Wichtig: immer `--assetPath resources` (steckt im npm-Script), weil `www/assets/` sonst verwechselt wird.

## CI (GitHub Actions)

Workflow: [`.github/workflows/android.yml`](../.github/workflows/android.yml) im Repo-Root,
läuft bei Änderungen unter `schueberfouer-android/` und manuell (`workflow_dispatch`).

- Die Spiel-Quellen sind nicht in diesem Repo: CI baut aus dem eingecheckten `www/` und
  prüft es nur (`sync-web --check`).
- **Immer:** Debug-APK → Artefakt `schueberfouer-debug-apk`.
- **Nur wenn das Secret `ANDROID_KEYSTORE_B64` existiert:** signierte Release-AAB → Artefakt
  `schueberfouer-release-aab`. Weitere Secrets: `ANDROID_KS_PASS`, `ANDROID_KEY_PASS`,
  optional `ANDROID_KS_ALIAS`. Keystore als Base64 ablegen: `base64 -w0 upload-keystore.jks`.
- `versionCode` = `github.run_number`.

## Technical notes (English)

- Capacitor 8.6.2 (`@capacitor/core|android|cli`), plugins: `@capacitor/app` 8.1.2,
  `@capacitor/splash-screen` 8.0.2, `@capacitor/screen-orientation` 8.0.2,
  `@capacitor/haptics` 8.0.2, `@capacitor-community/keep-awake` 8.0.1; icons via `@capacitor/assets` 4.0.0.
- compileSdk/targetSdk 36, minSdk 24, AGP 8.13.0, Gradle 8.14.3, JDK 21. No native `.so` libraries
  (16 KB page-size requirement is therefore moot).
- Origin stays `https://localhost` (Capacitor default). **Never change `server.hostname` /
  `androidScheme`**: `localStorage` saves (`fouer2026`, `fouer2026_settings`) are per origin.
- `android.minWebViewVersion = 89` (import maps need Chromium 89+).
- Manifest: `android:appCategory="game"` (Android 16 large-screen orientation exemption),
  `sensorLandscape`, `uses-feature glEsVersion 0x00030000` (WebGL2), touchscreen not required.
- `MainActivity`: edge-to-edge + cutout `ALWAYS/shortEdges`, sticky immersive via
  `WindowInsetsControllerCompat` (re-applied in `onWindowFocusChanged`/`onResume`),
  `FLAG_KEEP_SCREEN_ON`, window + WebView background `#05030f`, `OVER_SCROLL_NEVER`,
  renderer priority `IMPORTANT`.
- `native-bridge.js` is a classic script that returns immediately unless
  `Capacitor.isNativePlatform()`; it uses `Capacitor.Plugins.*` (no bundler) and only optional
  access to `window.G`, so the same `www/` still works in a desktop browser.
