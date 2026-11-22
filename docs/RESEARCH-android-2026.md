# Research: packaging "Schueberfouer 2026" (three.js/WebGL) as an offline Android app — state of 2026-11-22

Status legend: **[verified]** = checked today against the cited source or by inspecting the published package / live server; **[unverified]** = from general knowledge, not re-checked today.

---

## 0. TL;DR (decisions for the build agent)

| Item | Value |
|---|---|
| Approach | **Capacitor 8** (`@capacitor/cli` / `core` / `android` **8.6.2**) with all web files bundled into the APK |
| JDK | **21** (Capacitor 8's Android library compiles with `JavaVersion.VERSION_21`; container has OpenJDK 21.0.13) |
| Gradle wrapper | **8.14.3** (Capacitor 8 template; matches `/opt/gradle` 8.14.3 in the container) |
| Android Gradle Plugin | **8.13.0** (Capacitor 8 template; AGP 8.13 needs Gradle ≥ 8.13, build-tools 35.0.0, JDK ≥ 17, max API 36.1) |
| compileSdk / targetSdk / minSdk | **36 / 36 / 24** (Capacitor 8 template defaults; targetSdk 36 is what Google Play requires since 2026-08-31) |
| SDK packages | `platform-tools`, `platforms;android-36`, `build-tools;35.0.0` (AGP 8.13 default; latest is 37.0.0 / 36.1.0) |
| cmdline-tools | `commandlinetools-linux-16111833_latest.zip` (= cmdline-tools 23.0, current "latest") — HTTP 200 today |
| Node | ≥ 22 (Capacitor CLI 8 `engines.node >=22.0.0`); container has Node 22.23.5 |
| Plugins | `@capacitor/app` 8.1.2, `@capacitor/screen-orientation` 8.0.2, `@capacitor-community/keep-awake` 8.0.1, `@capacitor/haptics` 8.0.2, `@capacitor/splash-screen` 8.0.2, `@capacitor/status-bar` 8.0.4 (optional), **SystemBars is built into `@capacitor/core` 8** |
| Icons/splash | `@capacitor/assets` **4.0.0** (`npx @capacitor/assets generate --android --assetPath resources ...`) |
| Vendoring | three **0.170.0** from npm (already in `prototypes/schueberfouer/node_modules`); fonts via `@fontsource/bungee|creepster|nunito|oswald` **5.3.0** or self-hosted woff2 |
| CI actions | `actions/checkout@v7` (v7.0.1), `actions/setup-java@v6` (v6.3.0), `android-actions/setup-android@v4` (v4.0.4), `actions/setup-node@v7` (v7.1.0), `gradle/actions/setup-gradle@v6` (v6.4.1), `actions/upload-artifact@v7` (v7.0.2) |

---

## 1. Packaging approach

### 1.1 Capacitor — current version and Android requirements [verified]

- Current release: **8.6.2** for `@capacitor/cli`, `@capacitor/core`, `@capacitor/android` (npm, published 2026-11-16). Checked with `npm view`.
- From the Capacitor 8 Android template inside `@capacitor/cli@8.6.2` (`assets/android-template.tar.gz`), inspected directly:
  - `variables.gradle`: `minSdkVersion = 24`, `compileSdkVersion = 36`, `targetSdkVersion = 36`, `androidxActivityVersion = '1.11.0'`, `androidxAppCompatVersion = '1.7.1'`, `androidxCoreVersion = '1.17.0'`, `androidxWebkitVersion = '1.14.0'`, `coreSplashScreenVersion = '1.2.0'`, `cordovaAndroidVersion = '14.0.1'`.
  - root `build.gradle`: `com.android.tools.build:gradle:8.13.0`, `com.google.gms:google-services:4.4.4`.
  - `gradle-wrapper.properties`: `gradle-8.14.3-all.zip`.
  - Manifest activity `configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density"`, `launchMode="singleTask"`, only permission `INTERNET`.
  - `aaptOptions.ignoreAssetsPattern = '!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~'` (dot-files are NOT packaged; underscore-prefixed files are).
- `@capacitor/android@8.6.2` `capacitor/build.gradle`: `compileOptions { sourceCompatibility JavaVersion.VERSION_21; targetCompatibility JavaVersion.VERSION_21 }` → **JDK 21 required** to build.
- Capacitor 8 upgrade guide: AGP 8.13.0 (from 8.7.2), Gradle wrapper 8.14.3 (from 8.11.1), Kotlin 2.2.20 if used; requires Android Studio Otter 2025.2.1+ (irrelevant for CLI builds); **`android.adjustMarginsForEdgeToEdge` removed**, use the SystemBars core plugin + CSS `env()`; add `density` to `configChanges`; Gradle props use `=` syntax. Source: https://capacitorjs.com/docs/updating/8-0
- Environment setup: Node.js 22+; Android SDK platform API 24+. Source: https://capacitorjs.com/docs/getting-started/environment-setup
- Android support: "API 24+ (Android 7 or later)"; "Capacitor requires an Android WebView with Chrome version 60 or later". Source: https://capacitorjs.com/docs/android. In code: `Bridge.DEFAULT_ANDROID_WEBVIEW_VERSION = 60`, `MINIMUM_ANDROID_WEBVIEW_VERSION = 55`; configurable via `android.minWebViewVersion` in `capacitor.config`.
- AGP 8.13 compatibility table: Gradle min/default 8.13; SDK Build Tools min/default **35.0.0**; NDK default 27.0.12077973; JDK min/default 17; **max API level 36.1**. Source: https://developer.android.com/build/releases/agp-8-13-0-release-notes

### 1.2 Alternatives compared

| Criterion | **Capacitor 8 (recommended)** | TWA / Bubblewrap (`@bubblewrap/cli` 1.27.0) | Plain native WebView app |
|---|---|---|---|
| Offline bundling | All files in APK `assets/public`, served from `https://localhost` — works on first launch with no network | Content must be hosted on an HTTPS origin verified with Digital Asset Links; offline only after a service worker has cached it (first launch needs network) [TWA facts: https://developer.chrome.com/docs/android/trusted-web-activity/; SW/offline point unverified] | Possible via `WebViewAssetLoader` (androidx.webkit) — you re-implement what Capacitor gives you |
| Renderer | Android System WebView (Chromium) | User's Chrome (Custom Tabs protocol, Chrome 72+) — often slightly better GPU/feature parity | Android System WebView |
| WebGL2 perf | Same Chromium GPU stack as Chrome; hardware-accelerated by default | Same or marginally better | Same as Capacitor |
| Native extras (immersive, orientation, keep-awake, back button, haptics) | Maintained official/community plugins | Limited to web APIs + TWA manifest options | Hand-written Java/Kotlin |
| Maintenance | Template tracks Play requirements (targetSdk 36 already) | Requires a hosted website + assetlinks.json | Full ownership of Gradle/AndroidX upgrades |
| Play policy risk | Low (game content shipped in app) | Fine if you own the site | Low |

**Recommendation: Capacitor 8.** It is the only option that satisfies "fully offline from first launch" without hosting, keeps the code path identical to the browser build (ES modules + importmap work in WebView ≥ 89), and gives maintained plugins for the native pieces. A TWA is ruled out by the offline-first requirement and the need to host the game on a verified domain. A hand-written WebView app would be ~equal in performance but costs more maintenance for no gain.

---

## 2. Google Play requirements (2026)

- **Target API level** [verified]: "Starting August 31 2026: New apps and app updates must target **Android 16 (API level 36)** or higher" (Wear OS/Automotive 35, TV/XR 34). Existing apps must target API 35+ to remain available to new users on newer devices. Extension could be requested to **November 1, 2026** (that window has now passed). Source: https://developer.android.com/google/play/requirements/target-sdk → **use targetSdk 36** (Capacitor 8 default).
- **AAB** [verified]: "From August 2021, new apps are required to publish with the Android App Bundle on Google Play." Compressed download size of base + config APKs must be ≤ 4 GB; apps > 200 MB use Play Asset/Feature Delivery. Source: https://developer.android.com/guide/app-bundle. (Our game: ~12 MB assets + ~0.4 MB JS + three.js — far below limits.)
- **16 KB page size** [verified]: "all apps targeting Android 15 (API level 35) and higher must support 16 KB memory page sizes on 64-bit devices on Google Play. Starting **February 1, 2027**, if your app updates don't support 16 KB memory page sizes, you won't be able to release these updates." "If your app only uses code written in the Java programming language or in Kotlin, including all libraries or SDKs, then your app already supports 16 KB devices." Source: https://developer.android.com/guide/practices/page-sizes.
  - A Capacitor app with only the listed plugins ships **no `.so` files** [unverified for every plugin, but none of the listed ones contain NDK code — verify with `unzip -l app-release.apk | grep '\.so$'`]. If any appear: AGP ≥ 8.5.1 (we have 8.13) handles zip alignment; check with `zipalign -c -P 16 -v 4 app.apk` (build-tools ≥ 35.0.0) and `bundletool dump config --bundle=app.aab | grep alignment` (expect `PAGE_ALIGNMENT_16K`).
- **Edge-to-edge** [verified]: Android 15 enforced edge-to-edge for apps targeting API 35 (opt-out via `windowOptOutEdgeToEdgeEnforcement`); for apps targeting **API 36 the opt-out is deprecated and disabled** on Android 16 devices. Source: https://developer.android.com/about/versions/16/behavior-changes-16. For a fullscreen game this is moot if system bars are hidden (immersive), but the WebView must not rely on the opt-out.
- **Predictive back (API 36)** [verified]: on Android 16+, for apps targeting 36, "`onBackPressed` is not called and `KeyEvent.KEYCODE_BACK` is not dispatched anymore"; use supported APIs (OnBackPressedDispatcher) or opt out with `android:enableOnBackInvokedCallback="false"`. `@capacitor/app` 8.1.2 uses `OnBackPressedCallback` via `getOnBackPressedDispatcher()` (inspected source) → compatible.
- **Large screens / orientation (API 36)** [verified]: on displays with smallest width ≥ 600 dp, `screenOrientation`, `resizableActivity`, min/maxAspectRatio, `setRequestedOrientation()` are ignored — **except for games** "based on the `android:appCategory` flag". → set `android:appCategory="game"` on `<application>` so the landscape lock is honored on tablets/foldables. Temporary opt-out property `android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` exists but won't apply at API 37. Source: same Android 16 page.
- **WebView-related Play policy** [verified]: Spam policy "Webviews and Affiliate Spam" forbids apps whose primary purpose is to "provide a webview of a website without permission from the website owner or administrator" and affiliate-traffic apps (https://support.google.com/googleplay/android-developer/answer/9899034). Minimum-functionality policy: "We do not allow apps that only have limited functionality and content" (https://support.google.com/googleplay/android-developer/answer/9898783). A self-contained offline game shipped in the APK is not a "webview of a website" → no conflict. Malware policy restricts JavaScript interfaces loading untrusted content — keep `server.url` unset and don't load remote pages [policy summary from search; unverified wording].

---

## 3. Headless SDK install + CLI build

### 3.1 Install the Android SDK (verified URLs/package names, 2026-11-22)

Package metadata from `https://dl.google.com/android/repository/repository2-3.xml`: `cmdline-tools;latest` = 23.0 → `commandlinetools-linux-16111833_latest.zip`; `platform-tools` 37.0.3; platforms up to `android-37.2` (and betas); build-tools up to `37.0.0`.

```bash
export ANDROID_HOME=$HOME/android-sdk          # also export ANDROID_SDK_ROOT=$ANDROID_HOME for older tools
mkdir -p $ANDROID_HOME/cmdline-tools
cd /tmp && curl -fLO https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip
unzip -q commandlinetools-linux-16111833_latest.zip -d $ANDROID_HOME/cmdline-tools
mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest   # required layout
export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH
yes | sdkmanager --licenses >/dev/null
sdkmanager "platform-tools" "platforms;android-36" "build-tools;35.0.0"
# optional: "build-tools;36.1.0" (newer zipalign/apksigner); AGP 8.13 defaults to 35.0.0 and would auto-download it if licenses accepted
```

Container notes [verified]: OpenJDK 21.0.13, Gradle 8.14.3 at `/opt/gradle`, Node 22.23.5 / npm 10.9.9, `ANDROID_HOME` unset. Java runs with a proxy via `JAVA_TOOL_OPTIONS` (proxy 127.0.0.1); Gradle/sdkmanager should inherit it. If `sdkmanager` ignores the JVM proxy, pass `--proxy=http --proxy_host=127.0.0.1 --proxy_port=<port>` [unverified whether needed]. Write `sdk.dir=/path/to/android-sdk` into `android/local.properties` or export `ANDROID_HOME`.

### 3.2 Create + build the Capacitor project (CLI only)

```bash
npm i @capacitor/core@8.6.2 @capacitor/android@8.6.2
npm i -D @capacitor/cli@8.6.2
npx cap init "Schueberfouer 2026" lu.example.schueberfouer --web-dir www   # appId: choose your own reverse-DNS id
npx cap add android
npx cap sync android            # copies www/ -> android/app/src/main/assets/public and wires plugins
cd android
./gradlew assembleDebug         # -> app/build/outputs/apk/debug/app-debug.apk  (signed with ~/.android/debug.keystore, auto-created)
./gradlew bundleRelease         # -> app/build/outputs/bundle/release/app-release.aab (needs signingConfig, see below)
./gradlew assembleRelease       # -> app/build/outputs/apk/release/app-release.apk (signed if signingConfig set)
```
Gradle tasks: https://developer.android.com/build/building-cmdline [verified]. The wrapper (`./gradlew`) downloads Gradle 8.14.3 from services.gradle.org; alternatively run `/opt/gradle/bin/gradle` (same version).

Capacitor CLI alternative [verified flags in cli 8.6.2 source]: `npx cap build android --keystorepath ... --keystorepass ... --keystorealias ... --keystorealiaspass ... --androidreleasetype AAB|APK --signing-type jarsigner|apksigner`.

### 3.3 Signing

- **Debug**: automatic debug key (`~/.android/debug.keystore`, alias `androiddebugkey`, password `android`) — installable via `adb install`, **not accepted by Play**. [verified that debug builds are signed with the SDK debug key: building-cmdline page; keystore defaults unverified today]
- **Upload/release key** (generate once, keep it out of git):
```bash
keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload \
  -storepass "$KS_PASS" -keypass "$KEY_PASS" -dname "CN=Schueberfouer, O=Dev, C=LU"
```
- Gradle `app/build.gradle` (Groovy, values from env or `keystore.properties`, not hard-coded):
```groovy
android {
  signingConfigs {
    release {
      storeFile file(System.getenv("KS_FILE") ?: "../upload-keystore.jks")
      storePassword System.getenv("KS_PASS")
      keyAlias System.getenv("KS_ALIAS") ?: "upload"
      keyPassword System.getenv("KEY_PASS")
    }
  }
  buildTypes { release { signingConfig signingConfigs.release; minifyEnabled false } }
}
```
- Manual alternatives: APK → `zipalign -v -p 4 in.apk out.apk && apksigner sign --ks upload-keystore.jks out.apk && apksigner verify out.apk`; AAB → `jarsigner -keystore upload-keystore.jks app-release.aab upload` ("You cannot use apksigner to sign your app bundle"). Source: https://developer.android.com/build/building-cmdline [verified].
- For Play, enroll in Play App Signing; the generated key is then the **upload key** [unverified detail].
- To test an AAB locally without Play: `bundletool build-apks --bundle=app-release.aab --output=app.apks --ks=... --ks-key-alias=upload --mode=universal` [unverified flags today].

---

## 4. WebView performance and behaviour for a WebGL2 game

### 4.1 How Capacitor serves the files [verified from source]
- Default `server.androidScheme = "https"`, `server.hostname = "localhost"` → app origin **`https://localhost`**, served by `WebViewLocalServer` from APK assets (no real network). Secure context ⇒ WebGL2, WebAudio, `localStorage`, ES modules, workers all available.
- **Keep scheme+hostname unchanged forever**: `localStorage` (the game saves `fouer2026` and `fouer2026_settings`) is per-origin; changing them wipes saves.
- ES modules: Chrome 61+. **Import maps: Chrome/WebView 89+** (caniuse: "Chrome: supported from version 89") [verified for Chrome; WebView follows the same Chromium version — unverified as a separate caniuse row]. Capacitor's own floor is WebView 60 → set `android.minWebViewVersion: 89` in `capacitor.config` so devices with an older WebView get Capacitor's "update WebView" error instead of a blank screen. In practice WebView auto-updates via Play on Android 7+.
- Rewrite the importmap to local paths, e.g. `{"imports":{"three":"./vendor/three/build/three.module.js","three/addons/":"./vendor/three/examples/jsm/"}}`, copying from `node_modules/three` (0.170.0). Replace the Google Fonts `<link>` with self-hosted `@font-face` (woff2) — `@fontsource/*` 5.3.0 packages or downloaded files. No `fonts.googleapis.com`/`cdn.jsdelivr.net` request may remain (test with airplane mode).
- Alternatively bundle with Vite (8.3.8 current) — optional; plain copy + importmap is sufficient and lower risk.

### 4.2 Native settings (manifest / MainActivity)
- **Hardware acceleration**: "enabled by default if your Target API level is >=14" — `android:hardwareAccelerated="true"` is redundant but harmless. Never put the WebView on `LAYER_TYPE_SOFTWARE`. Source: https://developer.android.com/develop/ui/views/graphics/hardware-accel [verified]. Capacitor does not call `setLayerType` (grep of 8.6.2 source).
- **Orientation**: `android:screenOrientation="sensorLandscape"` on the activity (or `landscape`), plus `android:appCategory="game"` on `<application>` (needed for API 36 large-screen exemption, §2). Template `configChanges` already prevents activity recreation on rotation/density changes.
- **Immersive fullscreen** (official pattern, https://developer.android.com/develop/ui/views/layout/immersive [verified]):
```java
// MainActivity extends BridgeActivity
@Override public void onWindowFocusChanged(boolean hasFocus) {
  super.onWindowFocusChanged(hasFocus);
  if (hasFocus) hideSystemBars();
}
private void hideSystemBars() {
  WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
  c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
  c.hide(WindowInsetsCompat.Type.systemBars());
}
```
  Capacitor 8's built-in **SystemBars** plugin can also hide bars (`plugins.SystemBars.hidden: true` or `SystemBars.hide()`), but its `hide()` does not set `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE` (inspected `SystemBars.java`) — the native snippet above gives the "sticky" behaviour and re-hides after focus returns. Also use `<item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>` (API 28+) in the app theme so the canvas extends under the notch in landscape [unverified wording; attribute is standard]. Use `viewport-fit=cover` in the viewport meta and CSS `env(safe-area-inset-*)` / Capacitor's injected `--safe-area-inset-*` for HUD placement (SystemBars docs: WebView < 140 reports wrong `env()` values; `insetsHandling: "css"` injects correct vars). Source: https://capacitorjs.com/docs/apis/system-bars [verified].
- **Keep screen on**: `getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)` in `onCreate`, or `@capacitor-community/keep-awake` (which does exactly this — inspected source).
- **Renderer priority**: `bridge.getWebView().setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true)` — IMPORTANT is "the highest binding priority ... and the default value WebView uses" [verified constant docs], so this mainly documents intent; `waivedWhenNotVisible=true` lets the OS deprioritise the renderer in background. API level 26+ [unverified today] → guard with `Build.VERSION.SDK_INT >= 26`.
- **Renderer crash**: Capacitor's `BridgeWebViewClient.onRenderProcessGone` exists (source) — WebGL OOM kills the renderer; handle by reloading rather than crashing.
- **Zoom/overscroll/selection**: Capacitor sets `setBuiltInZoomControls(config.zoomEnabled)` (default false) and `setDisplayZoomControls(false)` [source]. Add `webView.setOverScrollMode(View.OVER_SCROLL_NEVER)` natively; in CSS `html,body{overscroll-behavior:none; touch-action:none; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; -webkit-tap-highlight-color:transparent}`; keep `user-scalable=no` (already in index.html).
- Capacitor already sets: JS on, DOM storage on, `setMediaPlaybackRequiresUserGesture(false)` (source). WebAudio `AudioContext` may still start suspended — call `ctx.resume()` on first touch and on `App` `resume`.
- `webContentsDebuggingEnabled` defaults to true in debug builds only (CapConfig source) → `chrome://inspect` remote debugging of the debug APK.

### 4.3 Web-side performance / pitfalls
- **Pointer Lock** is not available on Chrome for Android/WebView [unverified today]; the game already guards `requestPointerLock` with `!G.isMobile`, and its UA test (`/Android|Mobile/`) matches WebView. Touch controls must be the primary input.
- **Element.requestFullscreen()** in WebView depends on `WebChromeClient.onShowCustomView` (Capacitor implements it for video) — don't rely on it for the game; use native immersive mode.
- **devicePixelRatio cost**: mid-range phones report DPR 2.6–3.5; fill-rate dominates. The game caps at `min(DPR,2)*renderScale`; for Android cap at **1.0–1.5** by default and expose renderScale. Disable/downgrade the heaviest passes on mobile: `GTAOPass`, `UnrealBloomPass` (half-res), `SMAAPass` (use FXAA or MSAA off), `Reflector` (low res), Lensflare. Prefer `powerPreference: "high-performance"`, `antialias:false` with post-AA, shadows ≤ 1024 maps [general guidance, unverified benchmarks].
- **Memory**: the WebView renderer is a separate process; GPU texture memory is the usual OOM cause → compress/resize textures (≤ 2048², prefer KTX2/Basis via `KTX2Loader` if feasible), dispose unused geometries/materials, listen for `webglcontextlost`/`webglcontextrestored` [general guidance].
- **Pause** the render loop on `App` `pause` (rAF is throttled when hidden anyway) and resume audio on `resume`.
- **OffscreenCanvas** (WebGL in a worker) is supported in Chromium 69+ [unverified for WebView today] — not needed; avoid adding complexity.
- `isMobile` detection via UA will be true; touch UI path is used.

### 4.4 Back button [verified]
`@capacitor/app`: "Listening for this event will disable the default back button behaviour." Payload `{ canGoBack }`. Use:
```js
import { App } from '@capacitor/app';
App.addListener('backButton', () => { if (game.menuOpen) game.closeMenu(); else game.openPauseMenu(); /* confirm -> App.exitApp() */ });
App.addListener('pause',  () => game.pause());
App.addListener('resume', () => { audio.ctx?.resume(); });
```
`App.exitApp()`, `App.minimizeApp()` (Android), config `plugins.App.disableBackButtonHandler` (since 7.1.0). Source: https://capacitorjs.com/docs/apis/app. Works under API 36 predictive back (uses OnBackPressedDispatcher).

---

## 5. Plugins (versions from npm, 2026-11-22) [verified]

| Purpose | Package | Version | Notes |
|---|---|---|---|
| System bars / immersive | **SystemBars (core, in `@capacitor/core` 8)** | 8.6.2 | `hidden`, `style`, `insetsHandling` (`css` default / `native` / `disable`); `hide({bar})`, `show()`, `setStyle()`. Combine with native sticky-immersive snippet (§4.2). |
| Status bar (legacy) | `@capacitor/status-bar` | 8.0.4 | Only if `setBackgroundColor` etc. needed; not needed for a hidden-bars game |
| Edge-to-edge helper | `@capawesome/capacitor-android-edge-to-edge-support` | 8.0.8 (last publish 2026-04-13) | Not needed with Capacitor 8 SystemBars |
| Navigation bar | `@capgo/capacitor-navigation-bar` | 8.2.23 | Optional; feature set unverified |
| Splash screen | `@capacitor/splash-screen` | 8.0.2 | Uses AndroidX core-splashscreen 1.2.0 (template). Call `SplashScreen.hide()` after first frame/asset load; set `launchAutoHide:false` |
| Orientation | `@capacitor/screen-orientation` | 8.0.2 | `ScreenOrientation.lock({orientation:'landscape'})`; manifest lock is still preferred (no rotate flash) |
| Keep awake | `@capacitor-community/keep-awake` | 8.0.1 | `KeepAwake.keepAwake()`; uses `FLAG_KEEP_SCREEN_ON` |
| Haptics | `@capacitor/haptics` | 8.0.2 | `Haptics.impact({style: ImpactStyle.Light})`; needs `VIBRATE` permission (added by plugin manifest) [unverified] |
| App / back button | `@capacitor/app` | 8.1.2 | see §4.4 |
| Not found on npm | `@capacitor-community/immersive-mode`, `capacitor-plugin-immersive`, `@capacitor/system-bars` | — | do not use these names |

All official plugins at 8.x declare `peerDependencies: { "@capacitor/core": ">=8.0.0" }`.

### Icons + splash: `@capacitor/assets` 4.0.0 [verified README in package]
- Node ≥ 20.9.0. Easy mode: put `logo.png` (or `icon.png`, SVG allowed; optional `logo-dark.png`) in the asset dir, then:
```bash
npx @capacitor/assets generate --android --assetPath resources \
  --iconBackgroundColor '#1a0b2e' --splashBackgroundColor '#1a0b2e' --logoSplashScale 0.3
```
- Custom mode files: `icon-only.png`, `icon-foreground.png`, `icon-background.png` (≥ 1024×1024), `splash.png`, `splash-dark.png` (≥ 2732×2732).
- **Pitfall**: the tool looks in `assets/` first, then `resources/`. The game already has an `assets/` folder → keep the icon source in `resources/` and always pass `--assetPath resources` (or keep the Capacitor project root separate from the game's `assets/`).
- It generates adaptive icons (`mipmap-anydpi-v26` foreground/background) and splash drawables into `android/app/src/main/res`. Depends on `sharp` (prebuilt binaries from npm) [unverified install behaviour in this container].

---

## 6. GitHub Actions workflow

Latest tags today (via `git ls-remote --tags`) [verified]: `actions/checkout` v7.0.1, `actions/setup-java` v6.3.0, `android-actions/setup-android` v4.0.4 (default cmdline-tools 15859902 = 22.0, accepts licenses by default), `actions/setup-node` v7.1.0, `gradle/actions` v6.4.1, `actions/upload-artifact` v7.0.2.

```yaml
name: android
on: [push, workflow_dispatch]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: '22', cache: 'npm' }
      - uses: actions/setup-java@v6
        with: { distribution: 'temurin', java-version: '21' }
      - uses: android-actions/setup-android@v4
        with:
          packages: 'platform-tools platforms;android-36 build-tools;35.0.0'
      - uses: gradle/actions/setup-gradle@v6
      - run: npm ci
      - run: npm run build:web        # copies game + vendor three + fonts into www/
      - run: npx cap sync android
      - name: Decode upload keystore
        env:
          KS_B64: ${{ secrets.ANDROID_KEYSTORE_B64 }}
        if: ${{ env.KS_B64 != '' }}
        run: echo "$KS_B64" | base64 -d > android/upload-keystore.jks
      - name: Build
        working-directory: android
        env:
          KS_FILE: ${{ github.workspace }}/android/upload-keystore.jks
          KS_PASS: ${{ secrets.ANDROID_KS_PASS }}
          KS_ALIAS: upload
          KEY_PASS: ${{ secrets.ANDROID_KEY_PASS }}
        run: ./gradlew --no-daemon assembleDebug bundleRelease
      - uses: actions/upload-artifact@v7
        with:
          name: schueberfouer-android
          path: |
            android/app/build/outputs/apk/debug/*.apk
            android/app/build/outputs/bundle/release/*.aab
          if-no-files-found: error
```
Notes: the secret goes into a step `env` var and the `if:` tests that var, because a step `if:` cannot read `secrets` directly. Whether a step-level `env` is visible to that same step's `if:` is [unverified]. If it is not, set `KS_B64` at job level. Without the keystore secret, `bundleRelease` fails, so either make the keystore required or build only `assembleDebug` on forks. Never commit the `.jks`; store it base64-encoded in repo secrets. android-actions usage source: https://github.com/android-actions/setup-android [verified, README shows `@v4`, `actions/checkout@v7`, `actions/setup-java@v6`].

---

## 7. Checklist for the build agent

1. `www/` = copy of `index.html`, `js/`, `assets/`, `vendor/three` (0.170.0 `build/three.module.js` + needed `examples/jsm/**`), self-hosted fonts; rewrite importmap + font CSS; grep `www/` for `http` — zero external URLs.
2. `capacitor.config.json`: `appId`, `appName`, `webDir: "www"`, `android.minWebViewVersion: 89`, `plugins.SystemBars.hidden: true`, `plugins.SplashScreen.launchAutoHide: false`, keep default `https://localhost`.
3. Manifest: `android:appCategory="game"`, `android:screenOrientation="sensorLandscape"` (activity), keep template `configChanges`.
4. MainActivity: sticky immersive (`BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE` + `hide(systemBars())` in `onWindowFocusChanged`), `FLAG_KEEP_SCREEN_ON`, `setOverScrollMode(OVER_SCROLL_NEVER)`, optional `setRendererPriorityPolicy(IMPORTANT, true)`.
5. JS: `backButton` → pause menu / `exitApp()`, `pause`/`resume` hooks, mobile quality preset (DPR cap ≤ 1.5, no GTAO), `SplashScreen.hide()` after load.
6. Build: `assembleDebug` (test APK) + `bundleRelease` (signed AAB, targetSdk 36); verify `unzip -l *.apk | grep '\.so$'` empty (16 KB moot) and `apksigner verify`.
7. No emulator in container: functional testing must happen on a physical device (`adb install app-debug.apk`, `chrome://inspect` for console) — out of scope for CLI-only CI.

## Sources
- https://capacitorjs.com/docs/updating/8-0
- https://capacitorjs.com/docs/getting-started/environment-setup
- https://capacitorjs.com/docs/android
- https://capacitorjs.com/docs/apis/system-bars
- https://capacitorjs.com/docs/apis/app
- npm registry (`npm view`, `npm pack`) for all package versions and inspected sources: `@capacitor/cli|core|android@8.6.2`, `@capacitor/app@8.1.2`, `@capacitor/assets@4.0.0`, etc.
- https://dl.google.com/android/repository/repository2-3.xml (SDK package versions, cmdline-tools URL)
- https://developer.android.com/build/releases/agp-8-13-0-release-notes
- https://developer.android.com/google/play/requirements/target-sdk
- https://developer.android.com/guide/app-bundle
- https://developer.android.com/guide/practices/page-sizes
- https://developer.android.com/about/versions/16/behavior-changes-16
- https://developer.android.com/develop/ui/views/layout/immersive
- https://developer.android.com/develop/ui/views/graphics/hardware-accel
- https://developer.android.com/reference/android/webkit/WebView
- https://developer.android.com/build/building-cmdline
- https://developer.chrome.com/docs/android/trusted-web-activity/
- https://support.google.com/googleplay/android-developer/answer/9899034 (Spam: Webviews and Affiliate Spam)
- https://support.google.com/googleplay/android-developer/answer/9898783 (Minimum functionality)
- https://caniuse.com/import-maps
- https://github.com/android-actions/setup-android ; tags via `git ls-remote` for actions/checkout, setup-java, setup-node, upload-artifact, gradle/actions
