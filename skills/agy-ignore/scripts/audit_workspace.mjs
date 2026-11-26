#!/usr/bin/env node
// agy-ignore — Zero-dependency workspace bloat, sensitivity, and .gitignore leak auditor.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const W = (s) => s.split(' ');
const S = (s) => new Set(W(s));
const E = (s) => new Set(W(s).map((x) => `.${x}`));
const low = (s) => s.toLowerCase();
const cmp = (a, b) => a.localeCompare(b);
const fail = (m) => { throw new Error(m); };
const hasAny = (set, words) => W(words).some((w) => set.has(w));
const EMPTY = new Set();

export const NOISE_CATEGORIES = Object.freeze([
  'browser_profile', 'dependencies', 'build_cache',
  'archives_releases', 'corpus_or_intermediate', 'lockfiles',
  'model_media_assets',
]);
const [BROWSER, DEPS, CACHE, ARCH, CORPUS, , ASSETS] = NOISE_CATEGORIES;
const SECRETS = 'secrets_dir', CFG = 'local_config', KEY = 'private_key_or_cert';

const JS_LOCKS = 'package-lock.json pnpm-lock.yaml yarn.lock';
const ARCH_BASE = 'zip tar tgz 7z rar';
const MEDIA_BASE = 'mp4 mov mkv avi mp3 wav m4a';
const DB_BASE = 'db db-wal db-shm';
const SQLITE_EXTS = 'sqlite sqlite-wal sqlite-shm sqlite3 sqlite3-wal sqlite3-shm';
const PY_M = 'pyproject.toml requirements.txt setup.py';
const JAVA_M = 'pom.xml build.gradle build.gradle.kts';

const DEF_IG = '.antigravityignore';
const IGNORE_FILES = S(`.gitignore ${DEF_IG} .dshignore .geminiignore .aiexclude .cursorignore .dockerignore`);
const LOCKFILES = S(`${JS_LOCKS} bun.lockb bun.lock cargo.lock uv.lock poetry.lock pipfile.lock composer.lock gemfile.lock flake.lock`);
const ARCHIVE_EXTS = E(`${ARCH_BASE} bz2 xz gz dmg iso whl`);
const MEDIA_EXTS = E(`${MEDIA_BASE} webm flac ogg`);
const MODEL_EXTS = E('ckpt pth pt onnx safetensors gguf ggml tflite');
const DB_EXTS = E(`${DB_BASE} ${SQLITE_EXTS}`);
const CODE_EXTS = E('js mjs cjs ts tsx jsx py rs go java kt cs fs c cc cpp h hpp rb php swift sh ps1 bat cmd vue svelte');
const DOC_EXTS = E('md txt json jsonl csv tsv xml yaml yml srt vtt parquet');
const KEY_EXTS = E('pem key p12 pfx jks keystore kdbx dpapi');
const KEY_NAMES = S('id_rsa id_ed25519 id_ecdsa id_dsa');
const SECRET_JSONS = S('credentials.json secrets.json settings.local.json');
const DEP_DIRS = S('node_modules .venv venv .tox .pnpm-store .yarn bower_components pods .gradle');
const CACHE_DIRS = S('dist build out .next .nuxt .svelte-kit .turbo .cache .parcel-cache .vite .remotion coverage __pycache__ .pytest_cache .mypy_cache .ruff_cache .eslintcache storybook-static playwright-report test-results .vs');
const MARKERS = S(`package.json ${PY_M} cargo.toml go.mod ${JAVA_M}`);
const SCOPED = S('bin env');
const GENERIC_DIRS = new Set([...DEP_DIRS, ...CACHE_DIRS, 'target', 'vendor', 'obj']);
const LEAK_CATS = new Set([BROWSER, SECRETS, DEPS, CACHE, CORPUS]);
const STAT_KEYS = W('files bytes codeFiles docDataFiles archiveFiles mediaFiles weightFiles dbFiles');

const DOTNET_RE = /\.(csproj|fsproj|vbproj|sln)$/;
const BROWSER_RE = /^(\.?(edge|chrome|playwright|puppeteer|browser|selenium)[-_]?profile|\.playwright.*|user data)$/i;
const ARCHIVE_DIR_RE = /(^|[-_.])(releases?|archives?|backups?|snapshots?|dist-packages)$/i;
const ASSET_DIR_RE = /^(models?|pretrained[-_]?models?|.*[-_]?weights?([-_][^/]*)?|checkpoints?|voices?|voice[-_]?packs?|embeddings?)$/i;
const RUNTIME_DATA_RE = /^(state|runtime|.*[-_]data)$/i;
const RUNTIME_FILE_RE = /(token|\.pid$|\.log$|\.jsonl$)/i;
const INTERMEDIATE_RE = /^((0[1-3][-_]?)?(raw([-_]?data)?|normalized|chunks?.*)|.*[-_](chunks?.*|tmp)|\.?tmp|temp|intermediate|staging|outputs?|exports?|artifacts|traces|logs)$/i;
const BORDERLINE_RE = /^(04[-_]?cleaned|cleaned|datasets?|corpus|samples?|fixtures?|candidate|eval[-_]?data)$/i;
const CORPUS_RE = /^(0[1-4][-_]?(raw|normalized|chunks|cleaned)|.*chunks.*|corpus|datasets?)$/i;
const BROWSER_FPS = [['local state', 'default'], ['cookies', 'cache'], ['places.sqlite', 'prefs.js']];

const NODE_STACK = 'Node.js / TypeScript';
const STACKS = [
  [NODE_STACK, `package.json tsconfig.json ${JS_LOCKS}`, `node_modules/ ${JS_LOCKS} dist/ build/ out/ .next/ coverage/`],
  ['Python', `${PY_M} pipfile uv.lock .py`, '.venv/ venv/ __pycache__/ *.py[cod] .pytest_cache/ uv.lock poetry.lock'],
  ['Rust', 'cargo.toml cargo.lock', 'target/ Cargo.lock'],
  ['Go', 'go.mod go.sum', 'coverage.out'],
  ['Java / Gradle / Maven', `${JAVA_M} gradlew`, '.gradle/ target/ build/ *.class *.jar'],
  ['.NET / C#', '.csproj .sln .fsproj', 'obj/ packages/ *.nupkg'],
  ['AI / Data Corpus', '.jsonl .parquet', ''],
].map(([name, m, r]) => [name, S(m), r ? W(r) : []]);

export const toPosixPath = (p) => p.split(path.sep).join('/');
export const formatMB = (b) => +(b / 1048576).toFixed(2);
const pct = (a, b) => (b > 0 ? +((a / b) * 100).toFixed(1) : 0);

export function parseArgs(argv) {
  const o = { targetDir: '.', format: 'md', top: 12, maxDepth: 6, verify: false, ignoreFile: DEF_IG, help: false };
  let pos = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], eq = a.indexOf('='), f = eq < 0 ? a : a.slice(0, eq);
    const val = () => {
      const v = eq < 0 ? argv[++i] : a.slice(eq + 1);
      return v && (eq >= 0 || !v.startsWith('-')) ? v : fail(`Missing ${f}`);
    };
    const posInt = () => {
      const v = val();
      return /^[1-9]\d*$/.test(v.trim()) ? +v : fail(`Invalid ${f}: ${v}`);
    };
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--json') o.format = 'json';
    else if (a === '--verify') o.verify = true;
    else if (f === '--ignore-file') o.ignoreFile = val();
    else if (f === '--format') {
      const v = val();
      o.format = v === 'md' || v === 'json' ? v : fail(`Invalid ${f}: ${v}`);
    } else if (f === '--top') o.top = posInt();
    else if (f === '--max-depth') o.maxDepth = posInt();
    else if (a.startsWith('-')) fail(`Unknown: ${a}`);
    else if (pos) fail(`Extra: ${a}`);
    else { o.targetDir = a; pos = true; }
  }
  return o;
}

export const getUsageText = () =>
  'Usage: audit_workspace.mjs [dir] [--format md|json] [--json] [--top N] [--max-depth N] [--verify] [--ignore-file f] [-h]';

const hasBrowserFp = (kids) => BROWSER_FPS.some(([a, b]) => kids.has(a) && kids.has(b));
const isPyVenv = (l, kids) => l === 'env' && hasAny(kids, 'pyvenv.cfg site-packages');
const hit = (category, reason, borderline = false, sensitive = false) => ({ category, borderline, sensitive, reason });

const CA_PEM_RE = /(?:^|[-_.])(?:ca|cacert|ca[-_]?(?:bundle|certs?)|(?:root|trust)[-_]?ca)\.pem$/i;
const SEC_K_RE = /(secret|token|passw|(?:api|private|access|auth)[-_]?key|credential|cookie|dsn|webhook)/i;
const NLP_K_RE = /(?:^|[-_])(?:bos|eos|pad|unk|cls|sep|mask|start|stop|special|decoder_start)[-_]?tokens?(?:[-_]?ids?)?$|(?:^|[-_])token[-_]?ids?$/i;
const ML_K = S('architectures model_type hidden_size num_hidden_layers vocab_size batch_size learning_rate num_gpus n_fft hop_size win_size hop_length sampling_rate hr_sampling_rate upsample_rates resblock segment_size transformers_version s2_ckpt_dir save_weight_dir');

function isPublicCaPem(n, abs, sz) {
  if (!CA_PEM_RE.test(n) || !abs || sz <= 0 || sz > 524288) return false;
  try {
    const t = fs.readFileSync(abs, 'utf8').trimStart();
    return /^-----BEGIN (?:TRUSTED |X509 )?CERTIFICATE-----/.test(t) && !/PRIVATE KEY-----/.test(t);
  } catch { return false; }
}
function hasSecKey(v, d = 0) {
  if (!v || typeof v !== 'object' || d > 5) return false;
  return Array.isArray(v) ? v.some((x) => hasSecKey(x, d + 1)) : Object.entries(v).some(([k, x]) => (SEC_K_RE.test(k) && !NLP_K_RE.test(k)) || hasSecKey(x, d + 1));
}
function isMlConfig(abs, sz) {
  if (!abs || sz <= 0 || sz > 262144) return false;
  try {
    const j = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (j?.constructor !== Object || hasSecKey(j)) return false;
    const ks = new Set(Object.keys(j).map(low));
    for (const s of ['train', 'model', 'data']) if (j[s]?.constructor === Object) for (const k of Object.keys(j[s])) ks.add(low(k));
    let n = 0;
    for (const k of ks) if (ML_K.has(k) && ++n >= 2) return true;
    return false;
  } catch { return false; }
}

export function isSensitiveFile(fileName, sibs = EMPTY) {
  const l = low(fileName);
  const tag = (category, reason) => ({ category, reason });
  if (l === '.env' || l.startsWith('.env.')) {
    return /^\.env\.(example|sample|template|dist|schema|defaults)$/.test(l) ? null : tag('env_secret', 'Env');
  }
  if (KEY_EXTS.has(path.extname(l)) || KEY_NAMES.has(l)) return tag(KEY, 'Key/cert');
  if (SECRET_JSONS.has(l) || (l.includes('service-account') && l.endsWith('.json') && !/example|sample|template/.test(l))) {
    return tag(CFG, 'Secret JSON');
  }
  if (l === 'config.json' && W('example sample template').some((t) => sibs.has(`config.${t}.json`))) {
    return tag(CFG, 'Local config');
  }
  return null;
}

export function classifyDirectory(name, {
  files = 0, bytes = 0, codeFiles: cf = 0, docDataFiles: df = 0, archiveFiles: af = 0,
  mediaFiles: mf = 0, weightFiles: wf = 0, dbFiles: dbf = 0,
  hasGit, hasProjectMarker, directChildNamesLower: kids = EMPTY, siblingNamesLower: sibs = EMPTY,
} = {}) {
  const l = low(name), n = files || 1;
  if (BROWSER_RE.test(name) || hasBrowserFp(kids)) return hit(BROWSER, 'Browser profile', false, true);
  if (/^\.?secrets$/i.test(name)) return hit(SECRETS, 'Secrets', false, true);
  if (DEP_DIRS.has(l) || isPyVenv(l, kids)) return hit(DEPS, 'Deps');
  if (l === 'vendor' && (hasAny(sibs, 'go.mod composer.json gemfile') || files >= 50)) return hit(DEPS, 'Vendor');
  if (l === 'target' && hasAny(sibs, 'cargo.toml pom.xml')) return hit(DEPS, 'Target');
  if (hasGit || hasProjectMarker) return null;
  if (CACHE_DIRS.has(l)) return hit(CACHE, 'Cache');
  if ((l === 'obj' || l === 'bin') && ([...sibs].some((x) => DOTNET_RE.test(x)) || (l === 'bin' && sibs.has('obj')))) {
    return hit(CACHE, '.NET');
  }
  if (ARCHIVE_DIR_RE.test(name) && (af > 0 || cf === 0 || bytes >= 524288)) return hit(ARCH, 'Archives');
  if (ASSET_DIR_RE.test(name) && cf === 0 && (wf > 0 || mf > 0 || af > 0) && bytes >= 1048576) {
    return hit(ASSETS, 'Model/media assets');
  }
  if (RUNTIME_DATA_RE.test(name) && cf === 0 && (dbf > 0 || [...kids].some((k) => RUNTIME_FILE_RE.test(k)))) {
    const hasTok = [...kids].some((k) => k.includes('token'));
    return hit(CORPUS, 'Runtime state/data', false, hasTok);
  }
  if (INTERMEDIATE_RE.test(name)) {
    const codeHeavy = cf > 0 && cf / n > 0.3;
    return hit(CORPUS, codeHeavy ? 'Code in temp' : 'Intermediate', codeHeavy);
  }
  if (BORDERLINE_RE.test(name) && (files >= 5 || bytes >= 524288)) return hit(CORPUS, 'Borderline', true);
  if (cf === 0 && files >= 200 && df / n >= 0.75) return hit(CORPUS, `${files} non-code`, true);
  return null;
}

const under = (p, d) => p === d || p.startsWith(`${d}/`);
const isNested = (p, xs) => { for (const a of xs) if (under(p, a)) return true; return false; };
const dedupeTop = (ps) => {
  const out = [];
  for (const p of [...new Set(ps)].sort((a, b) => a.length - b.length || cmp(a, b))) {
    if (!isNested(p, out)) out.push(p);
  }
  return out;
};
const escPat = (p) => (p && (p[0] === '#' || p[0] === '!') ? `\\${p}` : p);
const anchor = (p) => { const e = escPat(p); return e.includes('/') ? e : `/${e}`; };
const shQ = (s) => `"${String(s).replace(/([\\"$`])/g, '\\$1')}"`;
const mdCell = (v) => String(v).replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
const bySize = (a, b) => b.bytes - a.bytes || (b.files || 0) - (a.files || 0) || cmp(a.path, b.path);
const keyInfo = (p) => { const b = low(path.posix.basename(p)); return [b, path.extname(b)]; };

function mdCode(v) {
  const s = mdCell(v);
  const f = '`'.repeat(Math.max(0, ...(s.match(/`+/g) || []).map((x) => x.length)) + 1);
  return s[0] === '`' || s.endsWith('`') ? `${f} ${s} ${f}` : `${f}${s}${f}`;
}

function gitZ(cwd, args, ok = [0], input) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd, input, encoding: 'utf8', windowsHide: true, maxBuffer: 16 << 20, timeout: 15000,
  });
  const error = r.error?.message || (!ok.includes(r.status) ? (r.stderr || '').trim() || `git exit ${r.status}` : null);
  return { items: !error && !r.status && r.stdout ? r.stdout.split('\0').filter(Boolean) : [], error };
}

function checkIgnore(cwd, ps) {
  if (!ps.length) return { ignored: EMPTY, error: null };
  const { items, error } = gitZ(cwd, ['check-ignore', '--no-index', '-z', '--stdin'], [0, 1], `${ps.join('\0')}\0`);
  return { ignored: new Set(items.map((x) => x.replace(/\/+$/, ''))), error };
}

function countRules(p) {
  try { return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => (l = l.trim()) && !l.startsWith('#')).length; }
  catch { return 0; }
}

export function auditWorkspace(targetDir = '.', { top = 12, maxDepth = 6, ignoreFile } = {}) {
  const ig = (typeof ignoreFile === 'string' && ignoreFile.trim()) || DEF_IG;
  if (!Number.isInteger(top) || top < 1 || !Number.isInteger(maxDepth) || maxDepth < 1) fail('Invalid top/maxDepth');
  const root = path.resolve(targetDir);
  let rootSt;
  try { rootSt = fs.statSync(root); } catch (e) { fail(`Cannot access ${root}: ${e.code || e.message}`); }
  if (!rootSt.isDirectory()) fail(`Not a dir: ${root}`);

  const stacks = new Set(), repos = new Set(), deepRepos = new Set(), dirs = new Map();
  const extraDb = new Set(), extraMedia = new Set(), filtFiles = new Map();
  const ignores = [], locks = [], archives = [], bigData = [], sens = [], pendingCfgs = [], permSamples = [];
  const counts = { totalDirs: 0, skippedSymlinks: 0, permissionErrors: 0, truncatedDirs: 0 };

  const permErr = (p, code) => {
    counts.permissionErrors++;
    if (permSamples.length < 20) permSamples.push({ path: p || '.', code: code || 'ERR' });
  };
  const addSens = (p, isDir, category, reason, bytes, extra) =>
    sens.push({ path: p, isDir, category, reason, bytes, sizeMB: formatMB(bytes), ...extra });

  function walk(absDir, relDir, depth, inOpaque) {
    const acc = {
      files: 0, bytes: 0, codeFiles: 0, docDataFiles: 0, archiveFiles: 0,
      mediaFiles: 0, weightFiles: 0, dbFiles: 0,
      hasGit: false, hasProjectMarker: false, directChildNamesLower: EMPTY,
    };
    let entries;
    try { entries = fs.readdirSync(absDir); } catch (e) { permErr(relDir, e.code); return acc; }

    const kids = new Set(entries.map(low));
    acc.directChildNamesLower = kids;
    acc.hasGit = entries.includes('.git');
    acc.hasProjectMarker = [...kids].some((l) => MARKERS.has(l) || DOTNET_RE.test(l));
    const base = relDir ? path.posix.basename(relDir) : '', lb = low(base);
    const opaque = inOpaque || DEP_DIRS.has(lb) || BROWSER_RE.test(base) || hasBrowserFp(kids) || isPyVenv(lb, kids);
    if (acc.hasGit && !opaque) (depth <= 2 ? repos : deepRepos).add(relDir || '.');

    for (const name of entries) {
      if (name === '.git') continue;
      const abs = path.join(absDir, name), rel = relDir ? `${relDir}/${name}` : name;
      let st;
      try { st = fs.lstatSync(abs); } catch (e) { permErr(rel, e.code); continue; }
      if (st.isSymbolicLink()) { counts.skippedSymlinks++; continue; }

      if (st.isDirectory()) {
        counts.totalDirs++;
        const nextD = depth + 1;
        if (nextD > maxDepth) { counts.truncatedDirs++; continue; }
        const sub = walk(abs, rel, nextD, opaque);
        for (const k of STAT_KEYS) acc[k] += sub[k];
        if (opaque) continue;

        const c = classifyDirectory(name, { ...sub, siblingNamesLower: kids });
        if (c?.category === BROWSER) stacks.add('Browser Automation');
        else if (c?.category === CORPUS && CORPUS_RE.test(name)) stacks.add('AI / Data Corpus');
        else if (c?.category === ASSETS) stacks.add('AI / Data Corpus');
        if (nextD <= 2 || c) {
          const { files, bytes, hasGit, hasProjectMarker } = sub;
          dirs.set(rel, {
            path: rel, name, depth: nextD, files, bytes, sizeMB: formatMB(bytes), hasGit, hasProjectMarker,
            category: null, borderline: false, sensitive: false, reason: null, ...c,
          });
        }
        if (c?.sensitive) addSens(rel, true, c.category, c.reason, sub.bytes, { files: sub.files });
      } else if (st.isFile()) {
        const sz = st.size || 0, l = low(name), ext = path.extname(l);
        const isArch = ARCHIVE_EXTS.has(ext) || l.endsWith('.tar.gz'), isLock = LOCKFILES.has(l);
        const isMedia = MEDIA_EXTS.has(ext), isModel = MODEL_EXTS.has(ext), isDb = DB_EXTS.has(ext);
        acc.files++; acc.bytes += sz;
        if (CODE_EXTS.has(ext)) acc.codeFiles++;
        if (DOC_EXTS.has(ext)) acc.docDataFiles++;
        if (isArch) acc.archiveFiles++;
        if (isMedia) acc.mediaFiles++;
        if (isModel) acc.weightFiles++;
        if (isDb) acc.dbFiles++;
        if (opaque) continue;

        if (depth <= 2) {
          if (l.startsWith('playwright.config.')) stacks.add('Browser Automation');
          else for (const [sName, m] of STACKS) if (m.has(l) || m.has(ext)) { stacks.add(sName); break; }
          if (IGNORE_FILES.has(l)) {
            ignores.push({ path: rel, name, scope: depth ? 'nested' : 'root', bytes: sz, activeRules: countRules(abs) });
          }
        }
        if (isLock || isArch) {
          const rec = { path: rel, name, bytes: sz, sizeMB: formatMB(sz) };
          if (isLock) locks.push(rec);
          if (isArch) { archives.push(rec); extraMedia.add(l.endsWith('.tar.gz') ? '*.tar.gz' : `*${ext}`); }
          filtFiles.set(rel, sz);
        }
        if (isMedia || isModel) { filtFiles.set(rel, sz); extraMedia.add(`*${ext}`); }
        else if (isDb) {
          filtFiles.set(rel, sz);
          extraDb.add(`*${ext}`);
          if (ext.startsWith('.sqlite3')) { extraDb.add('*.sqlite3'); extraDb.add('*.sqlite3-wal'); extraDb.add('*.sqlite3-shm'); }
          else if (ext.startsWith('.sqlite')) { extraDb.add('*.sqlite'); extraDb.add('*.sqlite-wal'); extraDb.add('*.sqlite-shm'); }
        }
        if (/\.(jsonl|parquet|csv)$/.test(ext) && sz >= 1048576) bigData.push(rel);
        const s = isSensitiveFile(name, kids);
        if (s && !(s.category === KEY && ext === '.pem' && isPublicCaPem(name, abs, sz))) addSens(rel, false, s.category, s.reason, sz);
        else if (!s && l === 'config.json') pendingCfgs.push([rel, sz, abs]);
      }
    }
    return acc;
  }

  const total = walk(root, '', 0, false);
  const allDirs = [...dirs.values()], d12 = [];
  const noisyTop = new Set(allDirs.filter((r) => r.depth >= 2 && r.category).map((r) => r.path.split('/')[0]));
  for (const r of allDirs) {
    if (r.depth === 1 && !r.category) {
      r.category = r.hasGit || r.hasProjectMarker ? 'project_container' : noisyTop.has(r.path) ? 'mixed_container' : null;
    }
    if (r.depth <= 2) d12.push(r);
  }

  const gitAvailable = !gitZ(root, ['--version']).error;
  const dOf = (r) => (r === '.' ? 0 : r.split('/').length);
  const allRepos = [...repos, ...deepRepos].sort((a, b) => dOf(b) - dOf(a) || cmp(a, b));
  const gitLeaks = [], gitRepos = [], gitignorePatches = [], gitignoreHardening = [];

  if (gitAvailable && repos.size) {
    const byRepo = new Map([...repos].map((r) => [r, { cands: new Map(), cfgs: [], hasEnv: false, keyExts: new Set() }]));
    const locate = (ws) => {
      const r = allRepos.find((x) => x === '.' || under(ws, x)), st = byRepo.get(r);
      return st && ws !== r ? [st, r === '.' ? ws : ws.slice(r.length + 1)] : null;
    };
    const addCand = (ws, isDir, category, highRisk) => {
      const loc = locate(ws);
      if (!loc) return;
      const [st, p] = loc, prev = st.cands.get(p);
      if (!prev || (highRisk && !prev.highRisk)) st.cands.set(p, { p, isDir, category, highRisk });
    };
    for (const s of sens) {
      addCand(s.path, s.isDir, s.category, true);
      const loc = locate(s.path);
      if (loc) {
        if (s.category === 'env_secret') loc[0].hasEnv = true;
        if (!s.isDir && s.category === KEY) {
          const [, ext] = keyInfo(s.path);
          if (KEY_EXTS.has(ext) && ext !== '.pem' && ext !== '.key') loc[0].keyExts.add(ext);
        }
      }
    }
    for (const r of allDirs) {
      if (!r.borderline && (LEAK_CATS.has(r.category) || (r.category === ASSETS && r.bytes >= 5 * 1048576))) {
        addCand(r.path, true, r.category, r.category === BROWSER || r.category === SECRETS);
      }
    }
    for (const [ws, sz, abs] of pendingCfgs) {
      const loc = locate(ws);
      if (loc) loc[0].cfgs.push([loc[1], ws, sz, abs]);
    }

    for (const repo of [...repos].sort(cmp)) {
      const repoAbs = repo === '.' ? root : path.join(root, ...repo.split('/'));
      const hasGitignore = fs.existsSync(path.join(repoAbs, '.gitignore'));
      const { cands, cfgs, hasEnv, keyExts } = byRepo.get(repo);
      const pushRepo = (checkedCandidates, leakCount, error = null) =>
        gitRepos.push({ repo, hasGitignore, checkedCandidates, leakCount, error });

      if (cfgs.length) {
        const res = checkIgnore(repoAbs, cfgs.map((c) => c[0]));
        if (res.error) { pushRepo(0, 0, res.error); continue; }
        for (const [p, ws, sz, abs] of cfgs) if (res.ignored.has(p) && !isMlConfig(abs, sz)) {
          addSens(ws, false, CFG, 'Gitignored config', sz);
          cands.set(p, { p, isDir: false, category: CFG, highRisk: true });
        }
      }

      const topDirs = [];
      const filtered = [...cands.values()]
        .sort((a, b) => (b.isDir - a.isDir) || a.p.length - b.p.length)
        .filter((c) => !isNested(c.p, topDirs) && (!c.isDir || topDirs.push(c.p)));
      const ig = checkIgnore(repoAbs, filtered.flatMap((c) => (c.isDir ? [c.p, `${c.p}/`] : [c.p])));
      let lsErr = ig.error;
      const tracked = [];
      for (let i = 0; !lsErr && i < filtered.length; i += 50) {
        const res = gitZ(repoAbs, ['--literal-pathspecs', 'ls-files', '-z', '--', ...filtered.slice(i, i + 50).map((c) => c.p)]);
        if (res.error) lsErr = res.error;
        else tracked.push(...res.items);
      }
      if (lsErr) { pushRepo(filtered.length, 0, lsErr); continue; }

      const rules = new Set(), untrack = new Set();
      let leakCount = 0;
      for (const { p, isDir, category, highRisk } of filtered) {
        const ign = ig.ignored.has(p), trk = tracked.filter((t) => (isDir ? under(t, p) : t === p)).length;
        if (ign && !trk) continue;
        const rule = escPat(isDir ? `${p}/` : p);
        leakCount++;
        if (!ign) rules.add(rule);
        if (trk) untrack.add(`git rm ${isDir ? '-r ' : ''}--cached -- ${shQ(isDir ? `${p}/` : p)}`);
        gitLeaks.push({
          repo, path: p, workspacePath: repo === '.' ? p : `${repo}/${p}`, isDir, category,
          severity: highRisk || trk ? 'high' : 'medium',
          ignoredByGitignore: ign, isTracked: trk > 0, trackedFileCount: trk, recommendedRule: rule,
          action: trk ? (ign ? 'untrack_already_tracked' : 'add_to_gitignore_and_untrack') : 'add_to_gitignore',
        });
      }
      if (leakCount) gitignorePatches.push({ repo, rulesToAdd: [...rules].sort(cmp), untrackCommands: [...untrack].sort(cmp) });

      // Preventive hygiene probes (separate from real leaks)
      const probes = ['__agy_probe__.pem', '__agy_probe__.key', ...[...keyExts].sort().map((e) => `__agy_probe__${e}`)];
      if (hasEnv) probes.unshift('.env.local');
      const hIg = checkIgnore(repoAbs, probes);
      if (!hIg.error) {
        const hRules = [];
        if (hasEnv && !hIg.ignored.has('.env.local')) {
          hRules.push('.env.*', '!.env.example', '!.env.sample', '!.env.template');
        }
        if (!hIg.ignored.has('__agy_probe__.pem')) hRules.push('*.pem');
        if (!hIg.ignored.has('__agy_probe__.key')) hRules.push('*.key');
        for (const ext of [...keyExts].sort()) {
          if (!hIg.ignored.has(`__agy_probe__${ext}`)) hRules.push(`*${ext}`);
        }
        if (hRules.length) gitignoreHardening.push({ repo, rulesToAdd: hRules });
      }
      pushRepo(filtered.length, leakCount);
    }
  }

  const topBySize = [...d12].sort(bySize).slice(0, top);
  const topByFileCount = [...d12].sort((a, b) => b.files - a.files || bySize(a, b)).slice(0, top);
  sens.sort((a, b) => cmp(a.path, b.path));

  const activeDirs = dedupeTop(
    allDirs.filter((d) => d.category && !d.category.endsWith('_container') && !d.borderline && (d.files || d.bytes || d.sensitive)).map((d) => d.path)
  );
  const activeSet = new Set(activeDirs);
  const borderlineDirs = allDirs.filter((d) => d.borderline && !isNested(d.path, activeSet)).sort(bySize);

  let estFiles = 0, estBytes = 0;
  const spec = [], stackExtra = [], tmpMap = new Map();
  for (const p of activeDirs) {
    const r = dirs.get(p), l = low(r.name);
    estFiles += r.files; estBytes += r.bytes;
    if ((r.category === DEPS || r.category === CACHE) && !SCOPED.has(l)) stackExtra.push(`${escPat(r.name)}/`);
    if (GENERIC_DIRS.has(l) && r.category !== BROWSER) continue;
    if (/_tmp$/i.test(r.name) && p.includes('/')) {
      const par = path.posix.dirname(p);
      tmpMap.set(par, [...(tmpMap.get(par) || []), p]);
    } else spec.push(`${SCOPED.has(l) || r.category === ASSETS || RUNTIME_DATA_RE.test(r.name) ? anchor(p) : escPat(p)}/`);
  }
  for (const [par, ps] of tmpMap) spec.push(ps.length >= 2 ? `${escPat(par)}/*_tmp/` : `${escPat(ps[0])}/`);

  const kRules = S('.env .env.* !.env.example !.env.sample !.env.template *.pem *.key secrets/');
  const deny = S('Read(.env) Read(.env.*) Read(**/.env) Read(**/.env.*) Read(**/*.pem) Read(**/*.key) Read(**/secrets/**)');
  for (const { path: p, isDir, category: c, bytes: sz } of sens) {
    if (!isDir) filtFiles.set(p, sz);
    if (isDir) deny.add(`Read(${p}/**)`);
    else if (!isDir && c === CFG) {
      deny.add(`Read(${p})`);
      if (!isNested(p, activeSet)) spec.push(anchor(p));
    } else if (!isDir && c === KEY) {
      const [base, ext] = keyInfo(p);
      if (KEY_EXTS.has(ext)) {
        kRules.add(`*${ext}`);
        if (ext !== '.pem' && ext !== '.key') deny.add(`Read(**/*${ext})`);
      } else if (KEY_NAMES.has(base)) {
        kRules.add(anchor(p));
        deny.add(`Read(${p})`);
      }
    }
  }
  for (const [p, sz] of filtFiles) if (!isNested(p, activeSet)) { estFiles++; estBytes += sz; }
  estFiles = Math.min(estFiles, total.files);
  estBytes = Math.min(estBytes, total.bytes);

  const detectedStacks = [...stacks].sort();
  const sSet = new Set(detectedStacks);
  if (locks.some((l) => /^(package|pnpm|yarn|bun)[-.]lock/i.test(l.name))) sSet.add(NODE_STACK);
  const uSpec = [...new Set(spec)].sort();
  const sRules = new Set([
    ...STACKS.filter(([n]) => sSet.has(n)).flatMap(([, , rules]) => rules),
    ...locks.map((l) => l.name), ...stackExtra,
    ...W(`log tmp ${DB_BASE}`).map((x) => `*.${x}`), '.DS_Store', 'Thumbs.db', ...extraDb,
  ]);
  const mRules = new Set(['*.tar.gz', ...W(`${ARCH_BASE} ${MEDIA_BASE}`).map((x) => `*.${x}`), ...extraMedia]);
  const bSet = new Set(dedupeTop(borderlineDirs.map((b) => b.path)));
  const toggles = [...new Set([
    ...[...bSet].map((p) => `# ${escPat(p)}/`),
    ...bigData.filter((p) => !isNested(p, activeSet) && !isNested(p, bSet)).map((p) => `# ${escPat(p)}`),
  ])];
  const hasRoot = ignores.some((f) => f.scope === 'root' && low(f.name) === low(ig));
  const antigravityIgnoreDraft = [
    `# ${ig} Draft`,
    ...(hasRoot ? [`# NOTE: Existing ${ig} — MERGE incrementally!`] : []),
    '', '# 1. Workspace bloat', ...(uSpec.length ? uSpec : ['# (None)']),
    '', '# 2. Deps, lockfiles & caches', ...sRules,
    '', '# 3. Archives, weights & media (keeps *.png, *.svg, *.json, *.md)', ...mRules,
    '', '# 4. Local env & keys (pair with Layer 1 permissions.deny)', ...kRules,
    '', '# 5. Optional toggles', ...(toggles.length ? toggles : ['# (None)']), '',
  ].join('\n');

  return {
    overview: {
      root, totalFiles: total.files, totalBytes: total.bytes, totalMB: formatMB(total.bytes),
      ...counts, maxDepth, permissionErrorSamples: permSamples, gitAvailable,
      skippedDeepGitRepos: [...deepRepos].sort(), detectedStacks,
      existingIgnoreFiles: ignores.sort((a, b) => cmp(a.path, b.path)),
      primaryIgnoreFile: ig,
    },
    topBySize, topByFileCount,
    lockfiles: locks.sort(bySize), archiveFiles: archives.sort(bySize).slice(0, 30),
    sensitiveItems: sens, gitRepos,
    gitLeaks: gitLeaks.sort((a, b) => (b.severity === 'high') - (a.severity === 'high') || b.isTracked - a.isTracked || cmp(a.workspacePath, b.workspacePath)),
    savings: {
      estimatedFilteredFiles: estFiles, estimatedFilteredBytes: estBytes, estimatedFilteredMB: formatMB(estBytes),
      fileReductionPct: pct(estFiles, total.files), sizeReductionPct: pct(estBytes, total.bytes),
      remainingFiles: Math.max(0, total.files - estFiles), remainingMB: formatMB(Math.max(0, total.bytes - estBytes)),
    },
    recommendations: { antigravityIgnoreDraft, gitignorePatches, gitignoreHardening, permissionsDeny: { permissions: { deny: [...deny] } } },
  };
}

export function verifyIgnoreFile(targetDir = '.', { ignoreFile = DEF_IG, maxFiles = 200000 } = {}) {
  const root = path.resolve(targetDir);
  const igPath = path.resolve(root, ignoreFile);
  if (!fs.existsSync(igPath) || !fs.statSync(igPath).isFile()) fail(`Ignore file not found: ${igPath}`);
  if (gitZ(root, ['--version']).error) fail('Git is required for --verify');

  const files = [];
  let truncated = false;
  function walkAll(absDir, relDir) {
    let entries;
    try { entries = fs.readdirSync(absDir); } catch { return; }
    for (const name of entries) {
      if (name === '.git') continue;
      const abs = path.join(absDir, name), rel = relDir ? `${relDir}/${name}` : name;
      let st;
      try { st = fs.lstatSync(abs); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walkAll(abs, rel);
      else if (st.isFile()) {
        if (files.length >= maxFiles) { truncated = true; return; }
        files.push({ rel, size: st.size || 0 });
      }
    }
  }
  walkAll(root, '');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ign-'));
  try {
    const init = gitZ(tmp, ['init', '-q']);
    if (init.error) fail(`git init failed: ${init.error}`);
    fs.copyFileSync(igPath, path.join(tmp, '.gitignore'));

    const checkBatch = (paths) => {
      const hitSet = new Set();
      for (let i = 0; i < paths.length; i += 4000) {
        const res = checkIgnore(tmp, paths.slice(i, i + 4000));
        if (res.error) fail(`git check-ignore failed: ${res.error}`);
        for (const p of res.ignored) hitSet.add(p);
      }
      return hitSet;
    };

    const ignSet = checkBatch(files.map((f) => f.rel));
    let iF = 0, iB = 0, kF = 0, kB = 0;
    for (const f of files) {
      if (ignSet.has(f.rel)) { iF++; iB += f.size; }
      else { kF++; kB += f.size; }
    }
    const totB = iB + kB;

    const trackedNonLockIgnored = [];
    const trackedLocksIgnored = [];
    if (fs.existsSync(path.join(root, '.git'))) {
      const trkRes = gitZ(root, ['ls-files', '-z']);
      if (!trkRes.error && trkRes.items.length) {
        const trkIgn = checkBatch(trkRes.items);
        for (const p of trkRes.items) {
          if (!trkIgn.has(p)) continue;
          if (LOCKFILES.has(low(path.posix.basename(p)))) trackedLocksIgnored.push(p);
          else trackedNonLockIgnored.push(p);
        }
      }
    }

    const templateNames = ['.env.example', '.env.sample', '.env.template'].filter((t) => fs.existsSync(path.join(root, t)));
    const tmplIgn = checkBatch(templateNames);
    const blockedTemplates = templateNames.filter((t) => tmplIgn.has(t));
    const readableTemplates = templateNames.filter((t) => !tmplIgn.has(t));

    const sensProbes = ['.env', '.env.local', 'secrets/sample.key'];
    const sensIgn = checkBatch(sensProbes);
    const missedProbes = sensProbes.filter((p) => !sensIgn.has(p));

    return {
      root, ignoreFile, activeRules: countRules(igPath), truncated,
      totalFiles: files.length, totalMB: formatMB(totB),
      ignoredFiles: iF, ignoredMB: formatMB(iB),
      fileReductionPct: pct(iF, files.length), sizeReductionPct: pct(iB, totB),
      remainingFiles: kF, remainingMB: formatMB(kB),
      readableTemplates, blockedTemplates,
      trackedLocksIgnored, trackedNonLockIgnored,
      missedSensitiveProbes: missedProbes,
      ok: blockedTemplates.length === 0 && trackedNonLockIgnored.length === 0 && missedProbes.length === 0,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function renderVerifyMarkdown(v) {
  const f = (n) => n.toLocaleString('en-US'), mb = (n) => n.toFixed(2), c = mdCode;
  const lines = [
    `# Ignore Verification Report (${c(v.ignoreFile)})`,
    '',
    `- **Root:** ${c(v.root)} | **Active rules:** ${v.activeRules} | **Status:** ${v.ok ? 'PASS' : 'WARN'}`,
    `- **Filtered:** ${f(v.ignoredFiles)}/${f(v.totalFiles)} (**${v.fileReductionPct}%**), ${mb(v.ignoredMB)}/${mb(v.totalMB)} MB (**${v.sizeReductionPct}%**) | **Kept readable:** ${f(v.remainingFiles)} (${mb(v.remainingMB)} MB)${v.truncated ? ' *(truncated)*' : ''}`,
    `- **Templates readable:** ${v.readableTemplates.length ? v.readableTemplates.map(c).join(', ') : '_None found_'}`,
    `- **Tracked lockfiles filtered (expected):** ${v.trackedLocksIgnored.length}`,
  ];
  if (v.blockedTemplates.length) lines.push(`- **WARN — Templates accidentally ignored:** ${v.blockedTemplates.map(c).join(', ')}`);
  if (v.missedSensitiveProbes.length) lines.push(`- **WARN — Sensitive probes NOT ignored:** ${v.missedSensitiveProbes.map(c).join(', ')}`);
  if (v.trackedNonLockIgnored.length) {
    const sample = v.trackedNonLockIgnored.slice(0, 20).map(c).join(', ');
    const more = v.trackedNonLockIgnored.length > 20 ? ` (+${v.trackedNonLockIgnored.length - 20} more)` : '';
    lines.push(`- **WARN — Git-tracked non-lock files ignored (${v.trackedNonLockIgnored.length}):** ${sample}${more}`);
  } else {
    lines.push('- **Tracked source/config files accidentally ignored:** 0');
  }
  return `${lines.join('\n')}\n`;
}

function tbl(spec, rows) {
  if (!rows.length) return ['_None._'];
  const cols = spec.split('|'), r = (xs) => `| ${xs.join(' | ')} |`;
  return [r(cols.map((x) => x.replace(/:$/, ''))), r(cols.map((x) => (x.endsWith(':') ? '---:' : '---'))), ...rows.map(r)];
}
const fence = (lang, body) => [`\`\`\`${lang}`, ...body, '```'];

export function renderMarkdown({ overview: o, topBySize, topByFileCount, sensitiveItems, gitRepos, gitLeaks, savings: sv, recommendations: rec }) {
  const f = (v) => v.toLocaleString('en-US'), mb = (v) => v.toFixed(2), c = mdCode;
  const cat = (d) => c(d.category ? `${d.category}${d.borderline ? ' (borderline)' : ''}` : '—');
  const pc = (x) => c(x.isDir ? `${x.path}/` : x.path);

  const git = !o.gitAvailable ? ['_Git unavailable._'] : !gitRepos.length ? ['_No Git repos._'] : [
    `Repos (${gitRepos.length}): ${gitRepos.map((x) => c(x.repo)).join(', ')}`,
    ...gitRepos.filter((x) => x.error).map((x) => `- **Warn:** ${c(x.repo)} (${mdCell(x.error)})`),
    ...(o.skippedDeepGitRepos?.length ? [`- **Deep (>2):** ${o.skippedDeepGitRepos.map(c).join(', ')}`] : []),
    '',
    ...tbl('Repo|Path|Cat|Sev|Ign|Trk|Action', gitLeaks.map((l) => [
      c(l.repo), pc(l), c(l.category), `**${l.severity}**`,
      l.ignoredByGitignore ? 'yes' : 'NO', l.isTracked ? `YES(${l.trackedFileCount})` : 'no', c(l.action),
    ])),
  ];

  const patches = [
    ...(rec.gitignorePatches.length ? [
      '> Confirm before `.gitignore` / `git rm --cached`.',
      ...rec.gitignorePatches.flatMap((p) => [
        `### \`${p.repo === '.' ? '.gitignore' : `${p.repo}/.gitignore`}\``,
        ...(p.rulesToAdd.length ? fence('gitignore', p.rulesToAdd) : []),
        ...(p.untrackCommands.length ? fence('bash', p.untrackCommands) : []),
      ]),
    ] : ['_None._']),
    ...(rec.gitignoreHardening?.length ? [
      '',
      '### Preventive Hardening (Optional — 0 active leaks)',
      ...rec.gitignoreHardening.flatMap((p) => [
        `\`${p.repo === '.' ? '.gitignore' : `${p.repo}/.gitignore`}\`:`,
        ...fence('gitignore', p.rulesToAdd),
      ]),
    ] : []),
  ];

  const sections = [
    ['1. Workspace Overview', [
      `- **Root:** ${c(o.root)} | **Files:** ${f(o.totalFiles)} (${mb(o.totalMB)} MB, ${f(o.totalDirs)} dirs) | **Stacks:** ${o.detectedStacks.join(', ') || 'None'}`,
      `- **Safety:** depth=${o.maxDepth}, symlinks=${o.skippedSymlinks}, permErrs=${o.permissionErrors}, truncated=${o.truncatedDirs}`,
      ...(o.existingIgnoreFiles.length ? ['', ...tbl('Ignore|Scope|Rules:', o.existingIgnoreFiles.map((x) => [c(x.path), x.scope, x.activeRules]))] : ['- **Ignores:** None']),
    ]],
    ['2. Top by Size', tbl('Dir|D:|MB:|Files:|Cat|Note', topBySize.map((d) => [c(`${d.path}/`), d.depth, mb(d.sizeMB), f(d.files), cat(d), mdCell(d.reason || '—')]))],
    ['3. Top by Files', tbl('Dir|D:|Files:|MB:|Cat', topByFileCount.map((d) => [c(`${d.path}/`), d.depth, f(d.files), mb(d.sizeMB), cat(d)]))],
    ['4. Sensitive Paths', tbl('Path|Type|Cat|MB:|Note', sensitiveItems.map((s) => [pc(s), s.isDir ? 'dir' : 'file', c(s.category), mb(s.sizeMB), mdCell(s.reason)]))],
    ['5. `.gitignore` Leaks', git],
    ['6. Savings', [
      `- **Filtered:** ${f(sv.estimatedFilteredFiles)}/${f(o.totalFiles)} (**${sv.fileReductionPct}%**), ` +
      `${mb(sv.estimatedFilteredMB)}/${mb(o.totalMB)} MB (**${sv.sizeReductionPct}%**) | **Left:** ${f(sv.remainingFiles)} (${mb(sv.remainingMB)} MB)`,
    ]],
    [`7. \`${o.primaryIgnoreFile || DEF_IG}\` Draft`, fence('gitignore', [rec.antigravityIgnoreDraft.trimEnd()])],
    ['8. `.gitignore` Patches', patches],
    ['9. Hard Security Wall Snippet (`permissions.deny`)', [
      '> Manual only (never auto-edit `~/.gemini/config/config.json`).',
      ...fence('json', [JSON.stringify(rec.permissionsDeny, null, 2)]),
    ]],
  ];
  return ['# Workspace Context & Ignore Audit Report', ...sections.flatMap(([t, b]) => ['', `## ${t}`, ...b]), ''].join('\n');
}

function realUrl(p) {
  try { p = fs.realpathSync(p); } catch {}
  const href = pathToFileURL(path.resolve(p)).href;
  return process.platform === 'win32' ? low(href) : href;
}

if (process.argv[1] && realUrl(fileURLToPath(import.meta.url)) === realUrl(process.argv[1])) {
  try {
    const o = parseArgs(process.argv.slice(2));
    if (o.help) console.log(getUsageText());
    else {
      const r = o.verify ? verifyIgnoreFile(o.targetDir, o) : auditWorkspace(o.targetDir, o);
      console.log(o.format === 'json' ? JSON.stringify(r, null, 2) : (o.verify ? renderVerifyMarkdown : renderMarkdown)(r));
      if (o.verify && !r.ok) process.exitCode = 1;
    }
  } catch (e) { console.error(`Error: ${e.message}`); process.exitCode = 1; }
}
