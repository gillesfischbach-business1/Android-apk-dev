/*
 * native-bridge.js — Android (Capacitor) glue for Schueberfouer 2026.
 * Loaded as a classic script before js/main.js. Does nothing in a normal
 * browser: every native call is behind Capacitor.isNativePlatform() and
 * optional chaining, so the game keeps working unchanged on the web.
 *
 * - Back button  -> Escape (close menu/dialog, open pause menu); on the title
 *                   screen with no menu open it asks and then exits the app.
 * - App pause    -> opens the pause menu (map tab) and suspends audio.
 * - App resume   -> resumes the WebAudio context.
 * - 'bump' event -> short haptic (autoscooter collisions).
 * - Native splash is hidden once #loading gets the class "gone".
 */
(function () {
  'use strict';
  var Cap = window.Capacitor;
  if (!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform())) return;

  var P = Cap.Plugins || {};
  var App = P.App, SplashScreen = P.SplashScreen, Haptics = P.Haptics, KeepAwake = P.KeepAwake;
  document.documentElement.classList.add('native-app');

  // Safe areas: the WebView is drawn under the display cutout (viewport-fit=cover);
  // keep HUD and touch controls inside the safe area. The canvas stays full-screen.
  var st = document.createElement('style');
  st.textContent =
    'html.native-app #hud, html.native-app #touch {' +
    ' top: env(safe-area-inset-top, 0px); right: env(safe-area-inset-right, 0px);' +
    ' bottom: env(safe-area-inset-bottom, 0px); left: env(safe-area-inset-left, 0px); }' +
    'html, body { overscroll-behavior: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }';
  (document.head || document.documentElement).appendChild(st);

  function G() { return window.G; }
  function ui() { return window.G && window.G.ui; }
  function call(fn) { try { var r = fn(); if (r && typeof r.catch === 'function') r.catch(function () {}); } catch (e) { /* ignore */ } }
  function escEvent() { return { code: 'Escape', key: 'Escape', preventDefault: function () {}, stopPropagation: function () {} }; }

  // ---- keep the screen on (also done natively with FLAG_KEEP_SCREEN_ON)
  call(function () { return KeepAwake && KeepAwake.keepAwake(); });

  // ---- back button
  var exitAsked = false;
  call(function () {
    return App && App.addListener('backButton', function () {
      var u = ui();
      if (!u) return; // still loading: ignore
      var onTitle = !u.started && !u.menuOpen && !(u.menu && u.menu.capture);
      if (onTitle) {
        if (exitAsked) return;
        exitAsked = true;
        var ok = true;
        try { ok = window.confirm('Spill zoumaachen?'); } catch (e) { ok = true; }
        exitAsked = false;
        if (ok) call(function () { return App.exitApp(); });
        return;
      }
      if (typeof u.onKey === 'function') u.onKey(escEvent());
    });
  });

  // ---- pause / resume
  call(function () {
    return App && App.addListener('pause', function () {
      var g = G(), u = ui();
      if (u && u.started && !u.menuOpen) {
        try {
          if (u.modal && typeof u.closeAll === 'function') u.closeAll();
          u.menu && u.menu.openPause && u.menu.openPause('kaart');
        } catch (e) { /* ignore */ }
      }
      call(function () { return g && g.audio && g.audio.ctx && g.audio.ctx.suspend(); });
    });
  });
  call(function () {
    return App && App.addListener('resume', function () {
      var g = G();
      call(function () { return g && g.audio && g.audio.ctx && g.audio.ctx.resume(); });
    });
  });

  // ---- haptics on autoscooter bumps (G is created by js/main.js after this script)
  var lastBuzz = 0;
  function hookGame() {
    var g = G();
    if (!g || typeof g.on !== 'function') return false;
    g.on('bump', function () {
      var now = Date.now();
      if (now - lastBuzz < 120) return; // don't spam the vibrator
      lastBuzz = now;
      call(function () { return Haptics && Haptics.impact({ style: 'MEDIUM' }); });
    });
    return true;
  }
  if (!hookGame()) {
    var tries = 0;
    var iv = setInterval(function () { if (hookGame() || ++tries > 600) clearInterval(iv); }, 100);
  }

  // ---- splash: hide when the in-game loading screen fades out
  var splashHidden = false;
  function hideSplash() {
    if (splashHidden) return;
    splashHidden = true;
    call(function () { return SplashScreen && SplashScreen.hide({ fadeOutDuration: 250 }); });
  }
  function checkLoading() {
    var l = document.getElementById('loading');
    var err = document.getElementById('err');
    if ((l && l.classList.contains('gone')) || (err && err.style.display && err.style.display !== 'none')) { hideSplash(); return true; }
    return false;
  }
  function watch() {
    if (checkLoading()) return;
    var mo = new MutationObserver(function () { if (checkLoading()) mo.disconnect(); });
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
  window.addEventListener('error', function () { setTimeout(checkLoading, 0); });
  setTimeout(hideSplash, 30000); // safety net: never keep the splash forever
})();
