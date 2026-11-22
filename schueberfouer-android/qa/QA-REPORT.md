# QA-Bericht: Schueberfouer 2026 (Android, Capacitor 8)

Unabhaengige QA, 2026-11-22. Geprueft: `android/app/build/outputs/apk/debug/app-debug.apk` (17.6 MB, 10:45) und
`android/app/build/outputs/bundle/release/app-release.aab` (15.6 MB, 10:46). Kein Gradle-Build gestartet.
Story-Typ: Integration (Packaging) | Evidenz: dieser Bericht + Screenshots in `qa/` | Gate: BLOCKING.

## Zusammenfassung

| # | Check | Ergebnis |
|---|---|---|
| 1 | Paket-Metadaten (APK + AAB) | PASS (2 Hinweise) |
| 2 | Keine .so, zipalign 16 KB, apksigner, jarsigner | PASS |
| 3 | Web-Bundle offline / Imports | PASS (1 Hinweis) |
| 4 | Offline-Laufzeittest 844x390 Android-UA | offen |
| 5 | native-bridge.js mit Capacitor-Mock | offen (Code-Review erfolgt, siehe unten) |
| 6 | CI-Workflow | PASS |
| 7 | Repo-Hygiene | PASS |

## 1. Paket-Metadaten - PASS

`aapt2 dump badging` (APK) und `apkanalyzer manifest print`:
- `package: name='lu.schueberfouer.game' versionCode='1' versionName='1.0.0'`, `minSdkVersion:'24'`, `targetSdkVersion:'36'`, compileSdk 36.
- `android:appCategory="0"` (= game), Activity `lu.schueberfouer.game.MainActivity` `exported="true"` mit MAIN/LAUNCHER, `screenOrientation="6"` (= sensorLandscape), `launchMode=2` (singleTask).
- Uebrige Komponenten: FileProvider (exported=false), androidx.startup InitializationProvider (exported=false), ProfileInstallReceiver (exported=true, aber geschuetzt durch `android.permission.DUMP`, AndroidX-Standard).
- Permissions: `INTERNET` (Capacitor-Standard), `VIBRATE` (von @capacitor/haptics, erwartet), `lu.schueberfouer.game.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (signature, von androidx.core automatisch). Nichts Unerwartetes.
- Features: `glEsVersion 0x30000 required=true`, touchscreen required=false, implizit `android.hardware.screen.landscape` (wegen sensorLandscape) - korrekt fuer ein Landscape-Spiel.
- Debug-APK: `application-debuggable` (erwartet fuer Debug).
- AAB: bundletool liegt nur als Library-Jar im Gradle-Cache (`bundletool-1.18.1.jar`, "no main manifest attribute"), daher: `base/` (Proto-Manifest + resources.pb + res/) aus dem AAB entpackt, mit `aapt2 convert --output-format binary` in ein Binaer-APK konvertiert und mit `aapt2 dump badging/xmltree` geprueft: gleiche package/minSdk/targetSdk/Permissions, appCategory=0, screenOrientation=6, **kein `debuggable`-Attribut (0 Treffer)** -> Release ist nicht debuggable.

Hinweise (minor):
- H1 `android:allowBackup="true"`: Spielstaende (WebView localStorage) gehen in Auto-Backup - harmlos/gewollt, aber bewusst entscheiden.
- H2 `versionCode=1` lokal; CI setzt `VERSION_CODE=github.run_number` - ok.

## 2. Native Libs / Alignment / Signaturen - PASS

- `unzip -l` APK und AAB: 0 Eintraege `*.so` bzw. `lib/` -> 16-KB-Page-Size-Anforderung trivial erfuellt.
- `zipalign -c -P 16 -v 4 app-debug.apk` -> "Verification succesful" (rc=0). AAB ebenfalls rc=0.
- `apksigner verify --print-certs app-debug.apk` -> Verifies, v2-Schema, Signer `CN=Android Debug` (Debug-Key, erwartet).
- `jarsigner -verify app-release.aab` -> "jar verified", Signer `CN=Schueberfouer 2026 (throwaway upload key), O=Dev, C=LU`, gueltig bis 2054. Die Meldungen "signed in JarFile but is not signed in JarInputStream" sind bei AABs normal.
  - Hinweis H3: lokales AAB ist mit einem **Wegwerf-Upload-Key** signiert - nicht in Play hochladen; echter Key nur via CI-Secret.

## 3. Web-Bundle - PASS

- `node scripts/sync-web.mjs --check` -> `verify OK: no CDN/googleapis/gstatic URLs, all three/addons imports present (www = 12.29 MB)`, rc=0.
- APK `assets/public` entpackt: Inhalt = www/ + `cordova.js`, `cordova_plugins.js` (von cap sync). `diff -rq www assets/public` zeigt sonst keine Unterschiede -> APK ist aktuell zu www/.
- Import-Aufloesung (eigenes Skript, folgt allen `import`/`export from`/`import()` ab `js/*.js` und `three.module.js`, Importmap `three`/`three/addons/`): **39 Dateien, 117 Specifier, 0 unaufgeloest** - sowohl in www/ als auch im APK.
- Externe URLs in JS/HTML/CSS:
  - `vendor/three/**`: nur Kommentare/Doku-Links (github.com/KhronosGroup, arxiv, nvidia, wikipedia, `my-cnd-server.com` als Beispiel im GLTFLoader-Kommentar, `activision.com/cdn/...` im GTAOShader-Kommentar) -> harmloser Text.
  - `js/menu.js:167` `https://mäin-server.lu/whep/schueberfouer` -> nur `placeholder`-Attribut eines Eingabefelds -> harmlos.
  - Laufzeit-Netzwerk nur opt-in: `js/cloud.js` `fetch(url, POST)` an eine vom Nutzer eingegebene WHEP-URL und `RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]})` - nur nach Klick auf "Verbannen" im Cloud-Tab. Kein automatischer Fetch.
  - Kein Treffer fuer googleapis/gstatic/jsdelivr/unpkg; Fonts lokal (`fonts.css` -> `./fonts/*.woff2`).
- Hinweis H4 (minor, Spielinhalt): Cloud-Tab-Text sagt "An dëser Artifact-Versioun blockéiert d'Sécherheetsrichtlinn ..." - in der Android-App sachlich falsch (Text aus der claude.ai-Artifact-Version).

## 4. Offline-Laufzeittest - offen

## 5. native-bridge.js - offen (Review)

Code-Review: alles hinter `Capacitor.isNativePlatform()`; jeder Plugin-Aufruf in `call()` mit try/catch und `.catch` -> fehlende Plugins werfen nicht. Back: Titel ohne Menue -> `confirm('Spill zoumaachen?')` -> `App.exitApp()`; sonst `ui.onKey({code:'Escape'})` (Modal schliessen / Pausemenue oeffnen / Menue schliessen). Pause -> Pausemenue 'kaart' + `audio.ctx.suspend()`, Resume -> `ctx.resume()`. Laufzeittest mit Mock steht aus.

## 6. CI-Workflow - PASS

- `.github/workflows/android.yml` parst (PyYAML), Job `build`.
- Action-Versionen = Research (Zeile 22): checkout@v7, setup-node@v7, setup-java@v6 (temurin 21), android-actions/setup-android@v4 (platforms;android-36, build-tools;35.0.0), gradle/actions/setup-gradle@v6, upload-artifact@v7. AGP 8.13.0 / Gradle 8.14.3 wie Research.
- Secrets: `HAS_KEYSTORE` auf Job-Ebene (secrets dort erlaubt), Keystore nach `$RUNNER_TEMP` dekodiert, Passwoerter nur als Step-env, Keystore-Loeschung `if: always()`, `permissions: contents: read`. Ohne Secrets: nur Debug-APK, Release-Steps uebersprungen.
- Pfade: `working-directory: schueberfouer-android` bzw. `schueberfouer-android/android`, Cache-Pfad `schueberfouer-android/package-lock.json`, Artefaktpfade korrekt relativ zum Repo-Root.
- Ohne Spielordner: `$GAME_DIR/index.html` fehlt -> `sync-web.mjs --check` auf committetem www/ (lokal geprueft: OK, benoetigt kein node_modules). `npx cap sync android` erzeugt das gitignorte `capacitor-cordova-android-plugins/` und `assets/public` vor Gradle neu.
- `gradlew` ist mit Mode 100755 committet; `gradle-wrapper.jar` committet.

## 7. Repo-Hygiene - PASS

- `git ls-files schueberfouer-android/www` = 117 = Dateien auf Disk; `git check-ignore` fuer www/ leer; `git status` sauber.
- `git ls-files | grep -iE 'jks|keystore|p12|node_modules|/build/|apk|aab|local.properties|password|secret|.env'` -> einziger Treffer `www/vendor/three/build/three.module.js` (falsch-positiv: three.js-Ordner "build").
- `.gitignore` deckt node_modules, Build-Ordner, `*.jks`, `*.keystore`, `*.p12`, `keystore.properties`, `upload-keystore*` ab; android/.gitignore ignoriert `*.apk`, `*.aab`, `capacitor-cordova-android-plugins`, `assets/public`.

## Geaenderte Dateien

Keine.
