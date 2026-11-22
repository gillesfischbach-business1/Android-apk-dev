#!/usr/bin/env node
// Copies the Schueberfouer 2026 browser game into www/ as a fully offline bundle
// for Capacitor: game files, vendored three.js (importmap rewritten to local
// paths), self-hosted fonts (@fontsource woff2) and the native bridge script.
// Re-runnable: www/ is rebuilt from scratch each time (www/native-bridge.js is
// kept, it lives in this repo, not in the game).
//
// Usage:
//   node scripts/sync-web.mjs [--game <dir>] [--three <dir>] [--full-jsm]
//   node scripts/sync-web.mjs --check     # only verify www/ (no copy)
//
// Env: GAME_DIR overrides the default game folder.
// No dependencies besides Node >= 22 built-ins.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, 'www');
const NM = path.join(ROOT, 'node_modules');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const CHECK_ONLY = args.includes('--check');
const FULL_JSM = args.includes('--full-jsm');
const GAME = path.resolve(opt('--game') || process.env.GAME_DIR || '/home/user/game-studio/prototypes/schueberfouer');

const FORBIDDEN = /cdn\.jsdelivr|googleapis|gstatic/i;
const TEXT_EXT = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.map']);
const KEEP = new Set(['native-bridge.js']); // repo-owned files inside www/

function die(msg) { console.error(`sync-web: ERROR: ${msg}`); process.exit(1); }
function log(msg) { console.log(`sync-web: ${msg}`); }
function copyFile(src, dst) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
function copyDir(src, dst) { fs.cpSync(src, dst, { recursive: true, filter: (s) => !path.basename(s).startsWith('.') }); }
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
function dirSize(dir) { return walk(dir).reduce((s, f) => s + fs.statSync(f).size, 0); }
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';

// ---------------------------------------------------------------- verification
function verify() {
  if (!fs.existsSync(path.join(WWW, 'index.html'))) die('www/index.html missing');
  const bad = [];
  for (const f of walk(WWW)) {
    if (!TEXT_EXT.has(path.extname(f).toLowerCase())) continue;
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => { if (FORBIDDEN.test(l)) bad.push(`${path.relative(WWW, f)}:${i + 1}: ${l.trim().slice(0, 160)}`); });
  }
  if (bad.length) { console.error(bad.join('\n')); die(`${bad.length} forbidden CDN/Google Fonts reference(s) remain in www/`); }
  // every bare/relative import must resolve to a file inside www/
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  for (const ref of ['vendor/three/build/three.module.js', 'fonts.css', 'native-bridge.js', 'js/main.js']) {
    if (!fs.existsSync(path.join(WWW, ref))) die(`www/${ref} missing`);
    if (!html.includes(ref)) die(`www/index.html does not reference ${ref}`);
  }
  const missing = [];
  for (const spec of collectAddonImports(path.join(WWW, 'js'))) {
    if (!fs.existsSync(path.join(WWW, 'vendor/three/examples/jsm', spec))) missing.push(spec);
  }
  if (missing.length) die(`three/addons imports not vendored: ${missing.join(', ')}`);
  log(`verify OK: no CDN/googleapis/gstatic URLs, all three/addons imports present (www = ${mb(dirSize(WWW))})`);
}

// ----------------------------------------------------- three.js import closure
const IMPORT_RE = /(?:import|export)\s*(?:[^'"`;]*?\sfrom\s*)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
function importsOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const m of src.matchAll(IMPORT_RE)) out.push(m[1] || m[2]);
  return out;
}
function collectAddonImports(jsDir) {
  const set = new Set();
  for (const f of walk(jsDir).filter((f) => /\.m?js$/.test(f))) {
    for (const s of importsOf(f)) if (s.startsWith('three/addons/')) set.add(s.slice('three/addons/'.length));
  }
  return set;
}
function vendorThree(threeDir) {
  const dstRoot = path.join(WWW, 'vendor/three');
  copyFile(path.join(threeDir, 'build/three.module.js'), path.join(dstRoot, 'build/three.module.js'));
  // three.module.js (r170) imports ./three.core.js only from r171 on; copy any sibling it needs
  for (const s of importsOf(path.join(threeDir, 'build/three.module.js'))) {
    if (s.startsWith('.')) copyFile(path.join(threeDir, 'build', s), path.join(dstRoot, 'build', s));
  }
  copyFile(path.join(threeDir, 'LICENSE'), path.join(dstRoot, 'LICENSE'));
  const jsmSrc = path.join(threeDir, 'examples/jsm');
  const jsmDst = path.join(dstRoot, 'examples/jsm');
  if (FULL_JSM) { copyDir(jsmSrc, jsmDst); log('three: copied full examples/jsm (--full-jsm)'); return; }
  // Default: copy only the transitive closure of addon modules the game imports.
  const queue = [...collectAddonImports(path.join(WWW, 'js'))].map((s) => path.join(jsmSrc, s));
  const seen = new Set();
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    if (!fs.existsSync(f)) die(`three addon not found: ${path.relative(threeDir, f)}`);
    seen.add(f);
    for (const s of importsOf(f)) {
      if (s.startsWith('.')) queue.push(path.resolve(path.dirname(f), s));
      else if (s.startsWith('three/addons/')) queue.push(path.join(jsmSrc, s.slice('three/addons/'.length)));
      else if (s !== 'three') die(`unexpected bare import '${s}' in ${path.relative(threeDir, f)}`);
    }
  }
  for (const f of seen) copyFile(f, path.join(jsmDst, path.relative(jsmSrc, f)));
  log(`three: vendored build/three.module.js + ${seen.size} examples/jsm modules (import closure)`);
}

// ---------------------------------------------------------------------- fonts
// family -> [fontsource package, weights]; latin + latin-ext subsets (Luxembourgish ë/é/ä are latin)
const FONTS = [
  ['bungee', [400]],
  ['creepster', [400]],
  ['nunito', [400, 700, 900]],
  ['oswald', [300, 400, 500, 600, 700]],
];
function vendorFonts() {
  const fontsDir = path.join(WWW, 'fonts');
  fs.mkdirSync(fontsDir, { recursive: true });
  let css = '/* Self-hosted fonts from @fontsource (SIL Open Font License 1.1). Generated by scripts/sync-web.mjs */\n';
  let n = 0;
  for (const [pkg, weights] of FONTS) {
    const pkgDir = path.join(NM, '@fontsource', pkg);
    if (!fs.existsSync(pkgDir)) die(`@fontsource/${pkg} not installed (run npm ci)`);
    for (const w of weights) {
      const src = fs.readFileSync(path.join(pkgDir, `${w}.css`), 'utf8');
      for (const block of src.match(/\/\*[^*]*\*\/\s*@font-face\s*{[^}]*}/g) || []) {
        if (!/-latin(-ext)?-\d+-normal\.woff2/.test(block)) continue;
        const file = block.match(/url\(\.\/files\/([^)]+\.woff2)\)/)[1];
        copyFile(path.join(pkgDir, 'files', file), path.join(fontsDir, file));
        css += block
          .replace(/src:[^;]+;/, `src: url(./fonts/${file}) format('woff2');`)
          .replace(/font-display:\s*swap/, 'font-display: block') + '\n';
        n++;
      }
    }
    const lic = path.join(pkgDir, 'LICENSE');
    if (fs.existsSync(lic)) copyFile(lic, path.join(fontsDir, `LICENSE-${pkg}.txt`));
  }
  fs.writeFileSync(path.join(WWW, 'fonts.css'), css);
  log(`fonts: ${n} @font-face rules (woff2) -> www/fonts.css`);
}

// ------------------------------------------------------------- index.html edit
function rewriteIndex() {
  const file = path.join(WWW, 'index.html');
  let html = fs.readFileSync(file, 'utf8');
  const before = html;

  // 1. importmap -> local vendor paths
  const importmap = '<script type="importmap">{ "imports": { "three": "./vendor/three/build/three.module.js", "three/addons/": "./vendor/three/examples/jsm/" } }</script>';
  if (!/<script type="importmap">[\s\S]*?<\/script>/.test(html)) die('importmap <script> not found in index.html');
  html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, importmap);

  // 2. Google Fonts <link>s -> local fonts.css
  html = html.replace(/[ \t]*<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>\s*\n?/g, '');
  html = html.replace(/(<script type="importmap">)/, '<link rel="stylesheet" href="fonts.css">\n$1');

  // 3. viewport-fit=cover so the canvas uses the display cutout area (safe areas handled in native-bridge.js)
  html = html.replace(/<meta name="viewport" content="([^"]*)">/, (m, c) =>
    c.includes('viewport-fit') ? m : `<meta name="viewport" content="${c},viewport-fit=cover">`);

  // 4. native bridge before the game module
  const main = html.match(/<script type="module" src="js\/main\.js"><\/script>/);
  if (!main) die('<script type="module" src="js/main.js"> not found in index.html');
  html = html.replace(main[0], `<script src="native-bridge.js"></script>\n${main[0]}`);

  if (html === before) die('index.html was not modified');
  fs.writeFileSync(file, html);
  log('index.html: importmap -> ./vendor/three, Google Fonts -> fonts.css, native-bridge.js injected');
}

// ------------------------------------------------------------------------ main
if (CHECK_ONLY) { verify(); process.exit(0); }

if (!fs.existsSync(path.join(GAME, 'index.html'))) die(`game folder not found: ${GAME} (use --game <dir> or GAME_DIR)`);
const THREE = path.resolve(opt('--three') || [path.join(GAME, 'node_modules/three'), path.join(NM, 'three')].find((d) => fs.existsSync(path.join(d, 'build/three.module.js'))) || '');
if (!fs.existsSync(path.join(THREE, 'build/three.module.js'))) die('three not found (expected <game>/node_modules/three)');
const threeVer = JSON.parse(fs.readFileSync(path.join(THREE, 'package.json'), 'utf8')).version;
log(`game: ${GAME}`);
log(`three: ${THREE} (v${threeVer})`);

// clean www/ but keep repo-owned files
const kept = {};
for (const k of KEEP) { const p = path.join(WWW, k); if (fs.existsSync(p)) kept[k] = fs.readFileSync(p); }
if (!kept['native-bridge.js']) die('www/native-bridge.js missing (it is part of this repo)');
fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });
for (const [k, buf] of Object.entries(kept)) fs.writeFileSync(path.join(WWW, k), buf);

copyFile(path.join(GAME, 'index.html'), path.join(WWW, 'index.html'));
copyDir(path.join(GAME, 'js'), path.join(WWW, 'js'));
copyDir(path.join(GAME, 'assets'), path.join(WWW, 'assets'));
vendorThree(THREE);
vendorFonts();
rewriteIndex();
fs.writeFileSync(path.join(WWW, 'BUILD-INFO.json'), JSON.stringify({ syncedAt: new Date().toISOString(), three: threeVer, fullJsm: FULL_JSM }, null, 2) + '\n');
verify();
