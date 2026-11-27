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
| 4 | Offline-Laufzeittest 844x390 Android-UA | PASS mit Defekten (D1, D3, D4) |
| 5 | native-bridge.js mit Capacitor-Mock | PASS mit Defekt (D2) |
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

## 4. Offline-Laufzeittest - PASS (mit UI-Defekten)

Setup: `assets/public` aus `app-debug.apk` entpackt, eigener Node-HTTP-Server auf 127.0.0.1, Playwright 1.63 / Chromium 1243 headless,
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, UA Pixel 7 / Android 14 / Chrome 131, 844x390, hasTouch, isMobile, DPR 1.
Alle Nicht-localhost-Requests per `context.route` abgebrochen. Skripte: Scratchpad `rt.cjs` (Haupttest + Mock) und `rt2.cjs` (Nachmessung);
Rohdaten: `qa/runtime-result.json`.

- `#loading.gone` nach **23.9 s** (SwiftShader).
- **Blockierte externe Requests: 0. Page errors: 0. Fehlgeschlagene Requests / HTTP >= 400: 0.** Console: nur 4x SwiftShader-Warnung "GPU stall due to ReadPixels" (Software-GL, kein App-Fehler).
- Fonts geladen (offline): Bungee 400, Creepster 400, Nunito 400, Oswald 400/500/700.
- Android-UA: `G.isMobile=true`, `G.quality="mettel"`, `G.settings.preset="mettel"`, `renderScale=0.85`.
- **Draw calls**: Titel `G.drawCalls=1806` (2.42 M Dreiecke), im Spiel `1893` (2.43 M Dreiecke). -> D4.
- Screenshots: `qa/01-title.png`, `qa/02-hud-touch.png`, `qa/03-pause-optiounen.png`, `qa/04-native-mock-after-pause.png`.

Titel: Logo `.tl-logo .k` "SCHUEBERFOUER" x 51-511, y 35-72, `scrollWidth 460 == clientWidth 460`, Font Bungee 38.8 px -> **nicht abgeschnitten** (auch visuell). Hinweis: Fusszeile "KLICK WIELEN" ist ein Desktop-Hinweis.

HUD (getBoundingClientRect, px, [links, oben, rechts, unten]):

| Element | Rect |
|---|---|
| #clock | 16,14,98,70 |
| #wallet | 140,18,262,75 |
| #minimap | 710,14,830,134 |
| #prompt | 403,268,441,290 (opacity 0) |
| #mission | nicht sichtbar (kein aktiver Missionstext) |
| #touch #stick | 26,242,156,372 |
| #touch E (gross) | 738,290,816,368 |
| #touch Q | 674,308,726,360 |
| #touch Space | 632,238,684,290 |
| #touch V | 694,238,746,290 |
| #touch M | 778,150,830,202 |
| #touch P | 778,206,830,258 |
| #touch J | 718,150,770,202 |
| #touch Escape (Menue) | 16,130,68,182 |

Paarweise Ueberlappung der gemessenen Elemente: **keine**; keines ragt aus dem Viewport.
Aber zusaetzlich sichtbar: Tastatur-Hinweisleiste **`#keys` 87,363,757,380** -> ueberlappt `#stick` um **69x9 px** und den E-Button um **19x5 px** (D1).

Pausemenue (`openPause('optiounen')`): Overlay 0,0,844,390. Tab-Leiste `.pm-tabs` clientWidth 533 < scrollWidth 700 (overflow-x auto):
"Optiounen" 770-895 (abgeschnitten, Screenshot zeigt "OPT"), "Spill" 899-977 komplett ausserhalb (D3). `.pm-body` scrollbar (377/254, overflow-y auto) - ok.
Kein Touch-Schliessen-Button im Pausemenue (nur Fusszeile "ESC WEIDERSPILLEN"); auf Android uebernimmt die Zurueck-Taste das (siehe 5).

## 5. native-bridge.js - PASS (mit Defekt D2)

Test mit `addInitScript`-Mock (`isNativePlatform:()=>true`, App/SplashScreen/Haptics/KeepAwake, KeepAwake liefert absichtlich rejected Promise), echtes Spiel aus APK-Assets:

| Schritt | Ergebnis |
|---|---|
| Init | Listener backButton/pause/resume registriert, `html.native-app` gesetzt, KeepAwake 1x (Reject still geschluckt), SplashScreen.hide 1x nach `#loading.gone` |
| Back auf Titel | `confirm('Spill zoumaachen?')` -> akzeptiert -> `App.exitApp` 1x - ok |
| Back auf Titel, Tages-Auswahl (`#tlsub`) offen | **Exit-Dialog + exitApp** statt zurueck zum Titelmenue (D2) |
| Titel -> Optiounen, Back | Menue geschlossen, zurueck zum Titel, kein Exit - ok |
| Im Spiel, Back | Pausemenue (Tab kaart) offen - ok |
| Im Pausemenue, Back | Menue zu, Spiel laeuft - ok |
| App pause | Pausemenue offen, `AudioContext.state=suspended` - ok |
| App resume | `state=running`, Menue bleibt offen (Spieler setzt bewusst fort) - ok |
| 2x `bump` < 120 ms | Haptics.impact genau 1x (Drosselung) - ok |

Fehlende Plugins: Seite nur mit `native-bridge.js`, `Plugins={App:{addListener}}` ohne exitApp/Splash/Haptics/KeepAwake und ohne `window.G`: backButton/pause/resume -> keine Exception; mit Fake-G erneut ok.
`Capacitor={isNativePlatform}` ganz ohne `Plugins`: keine pageerror. Gesamtlauf: 0 page errors.

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

## Defekte

| ID | Schwere | Beschreibung | Reproduktion |
|---|---|---|---|
| D1 | major (UI, Touch) | Tastatur-Hinweisleiste `#keys` ("E AKTIOUN, Q KOMPASS, ... ESC MENÜ") wird auf Mobil/Android angezeigt, ist dort sinnlos und ueberlappt den Joystick (69x9 px) und den E-Button (19x5 px). Ursache im Spiel (kein Ausblenden bei `G.isMobile`). | APK-Assets offline, 844x390, Android-UA, Spiel starten -> `qa/02-hud-touch.png` unten; `#keys` rect 87,363,757,380 vs `#stick` 26,242,156,372. Vorschlag ohne Spieleingriff: in native-bridge.js CSS `html.native-app #keys{display:none}` ergaenzen (dann www/ + Build neu). |
| D2 | minor (UX) | Zurueck-Taste auf der Titel-Unterseite "Wéi en Dag op der Fouer?" (`#tlsub`) fragt "Spill zoumaachen?" und beendet die App statt die Unterseite zu schliessen. | Mock-Capacitor, Titel -> "Spill ufänken" -> backButton -> confirm-Dialog, exitApp-Zaehler +1. Vorschlag: in native-bridge.js im Titel-Zweig zuerst `#tlsub` mit Inhalt leeren/schliessen (Spiel-API dafuer pruefen). |
| D3 | minor (UI) | Pausemenue-Tableiste bei 844 px zu breit: "Optiounen" abgeschnitten, "Spill" (Speichern/Neistart) unsichtbar; nur per horizontalem Wischen erreichbar, ohne Hinweis. Fusszeile zeigt Desktop-Hinweise (ESC, Pfeile, KLICK), kein Touch-Schliessen-Button. Spielseitig. | `G.ui.menu.openPause('optiounen')` -> `qa/03-pause-optiounen.png`; `.pm-tabs` clientWidth 533 / scrollWidth 700. |
| D4 | major (Performance-Risiko, nicht auf Geraet verifiziert) | Mobil-Preset "mettel" erzeugt ~1800-1900 Draw Calls und ~2.4 M Dreiecke - fuer Mittelklasse-Android-GPUs sehr hoch (ueblich < 500 Draw Calls). Messung in SwiftShader, Wert ist aber geraeteunabhaengig. | `G.drawCalls` nach Spielstart mit Android-UA. Empfehlung: Test auf echtem Geraet (FPS), ggf. Android-Default "niddreg". |
| D5 | minor (Text) | Cloud-Tab sagt "An dëser Artifact-Versioun ..." - in der App falsch; Cloud-Gaming nutzt `stun:stun.l.google.com` (nur opt-in). | Pause -> Optiounen -> Cloud Gaming. |

Hinweise ohne Defekt: H1 allowBackup=true, H3 lokales AAB mit Wegwerf-Key, Titel-Fusszeile "KLICK WIELEN" (Desktop-Text), Tipp-Toast "Dréck [Q]" verweist auf Tastatur.

Nicht geprueft: echtes Geraet/Emulator (kein Emulator im Container), System-Bars/Safe-Area mit echten Insets, WebView-Version < Chrome 131.

## Nachtest nach den Fixes (22.11.2026)

Offline-Bundle aus `www/` (Stand nach PR #1 plus Tipp-Texte), 844x390, Android-UA, Touch, Capacitor-Mock. Skript: lokaler Server + Playwright, keine externen Requests, keine Seitenfehler.

| ID | Ergebnis | Messung |
|---|---|---|
| D1 | BEHOBEN | `#keys` vorhanden, `display: none` bei `G.isMobile` -> `qa/05-retest-hud.png` |
| D2 | BEHOBEN | Titel -> Tagesauswahl offen (465 Zeichen), Back -> `#tlsub` leer, `exitApp` 0x aufgerufen |
| D3 | BEHOBEN | Schliessen-Knopf `#pmclose` sichtbar und funktioniert, Tabs horizontal scrollbar, alle 6 Reiter vorhanden -> `qa/06-retest-pause.png` |
| D4 | VERBESSERT | Mobil-Standard: 1248 Draw Calls (vorher ~1850), 1,69 M Dreiecke (vorher 2,4 M), Schatten aus, 280 Besucher. Echte FPS nur auf Geraet messbar |
| D5 | BEHOBEN | Cloud-Seite: "An der Android-App funktionéiert Cloud Gaming, soubal en WHEP-Server ugi gëtt ..." -> `qa/07-retest-cloud.png` |
| H (Tipp-Toast) | BEHOBEN | Auf Touch-Geraeten werden Tasten-Hinweise ersetzt: "Dréck [🧭] ... [☰] fir Kaart" statt "[Q]"/"[Esc]"; gilt auch fuer Missionstexte und Fahrgeschaeft-Hinweise |

Debug-APK lokal neu gebaut (`assembleDebug`, 17,6 MB). Weiter offen: Test auf echtem Geraet/Emulator (Container hat kein KVM).

## Stand v0.6 (27.11.2026)

Spielpaket neu synchronisiert: Grafikstile (Standard „Realistesch"), detaillierte Buden und Fahrgeschaefte, Figurentypen mit
Gehbewegung, Gelaender-Kollision, Asphalt-Korrektur. three.js im Paket jetzt r187 (vorher r170), aus den devDependencies der App.

Offline-Start aus `www/`, 844x390, Android-UA, Touch: Spiel startet, 22 Fahrgeschaefte, three r187, Preset „mettel", keine
Seitenfehler, keine externen Requests, Tastaturleiste ausgeblendet. Gemessen: 1.247 Draw Calls (vorher 1.248), 2,05 M Dreiecke
(vorher 1,69 M). Screenshot `qa/08-v06-mobile.png`. Debug-APK lokal gebaut (24,2 MB), `apksigner verify` ohne Fehler.

Nicht geprueft: echtes Geraet/Emulator, Bildrate, Klang in diesem Lauf (zuletzt in v0.5 geprueft).

## Geaenderte Dateien

Keine Dateien des Projekts geaendert. Neu angelegt nur `qa/` (dieser Bericht, 4 Screenshots, `runtime-result.json`).
