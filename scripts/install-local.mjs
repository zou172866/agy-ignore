#!/usr/bin/env node
/**
 * agy-ignore — Local skill installer / drift checker / uninstaller.
 * Syncs skills/agy-ignore/ -> <home>/.gemini/config/skills/agy-ignore/ (overridable via --dest).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
export const DEFAULT_SOURCE_DIR = path.join(REPO_ROOT, 'skills', 'agy-ignore');

const IGNORED_OS_JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

export function getDefaultDestDir(homeDir = os.homedir()) {
  return path.join(homeDir, '.gemini', 'config', 'skills', 'agy-ignore');
}

function readFlagValue(argv, i, flagName) {
  const arg = argv[i];
  const hasEq = arg.includes('=');
  const value = hasEq ? arg.slice(arg.indexOf('=') + 1) : argv[i + 1];
  const nextIndex = hasEq ? i : i + 1;
  if (!value || (!hasEq && value.startsWith('-'))) {
    throw new Error(`Missing value for ${flagName}.`);
  }
  return { value, nextIndex };
}

export function parseArgs(argv) {
  const opts = {
    source: DEFAULT_SOURCE_DIR,
    dest: getDefaultDestDir(),
    check: false,
    uninstall: false,
    dryRun: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    if (arg === '--check') {
      opts.check = true;
      continue;
    }
    if (arg === '--uninstall') {
      opts.uninstall = true;
      continue;
    }
    if (arg === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (arg === '--json') {
      opts.json = true;
      continue;
    }
    if (arg === '--dest' || arg.startsWith('--dest=')) {
      const { value, nextIndex } = readFlagValue(argv, i, '--dest');
      i = nextIndex;
      opts.dest = path.resolve(value);
      continue;
    }
    if (arg === '--source' || arg.startsWith('--source=')) {
      const { value, nextIndex } = readFlagValue(argv, i, '--source');
      i = nextIndex;
      opts.source = path.resolve(value);
      continue;
    }
    throw new Error(`Unknown option: "${arg}". Run with --help for usage.`);
  }

  if (opts.check && opts.uninstall) {
    throw new Error('Cannot combine --check and --uninstall.');
  }

  return opts;
}

export function getUsageText() {
  return [
    'Usage: node scripts/install-local.mjs [options]',
    '',
    'Options:',
    '  --dest <path>      Override destination directory (default: ~/.gemini/config/skills/agy-ignore)',
    '  --source <path>    Override source skill directory (default: <repo>/skills/agy-ignore)',
    '  --check            Verify exact file list + SHA-256 content match (zero drift)',
    '  --uninstall        Remove installed skill directory',
    '  --dry-run          Preview changes without modifying disk',
    '  --json             Output structured JSON result',
    '  -h, --help         Show this help message',
  ].join('\n');
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function lstatOrNull(targetPath) {
  try {
    return fs.lstatSync(targetPath);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function collectEntries(rootDir) {
  const files = new Map();
  const symlinks = [];
  const rootStat = lstatOrNull(rootDir);
  if (!rootStat || !rootStat.isDirectory()) {
    return { files, symlinks };
  }

  function walk(absDir, relDir) {
    const entries = fs.readdirSync(absDir).sort();
    for (const name of entries) {
      if (IGNORED_OS_JUNK.has(name)) continue;
      const absPath = path.join(absDir, name);
      const relPath = relDir ? `${relDir}/${name}` : name;
      const stat = fs.lstatSync(absPath);
      if (stat.isSymbolicLink()) {
        symlinks.push(toPosix(relPath));
        continue;
      }
      if (stat.isDirectory()) {
        walk(absPath, relPath);
      } else if (stat.isFile()) {
        files.set(toPosix(relPath), sha256File(absPath));
      }
    }
  }

  walk(rootDir, '');
  return { files, symlinks };
}

export function collectFileHashes(rootDir) {
  return collectEntries(rootDir).files;
}

function normalizeForCompare(p) {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isSameOrInside(child, parent) {
  const rel = path.relative(normalizeForCompare(parent), normalizeForCompare(child));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function assertSafeDestDir(destDir, sourceDir = DEFAULT_SOURCE_DIR) {
  const resolved = path.resolve(destDir);
  const resolvedSource = path.resolve(sourceDir);
  const parsed = path.parse(resolved);
  const home = path.resolve(os.homedir());
  if (
    normalizeForCompare(resolved) === normalizeForCompare(parsed.root) ||
    normalizeForCompare(resolved) === normalizeForCompare(home) ||
    normalizeForCompare(resolved) === normalizeForCompare(REPO_ROOT)
  ) {
    throw new Error(`Refusing to operate on unsafe destination path: ${resolved}`);
  }
  if (isSameOrInside(resolved, resolvedSource) || isSameOrInside(resolvedSource, resolved)) {
    throw new Error(`Refusing to use source skill directory or its ancestor/descendant as destination: ${resolved}`);
  }
}

export function checkSkill(options = {}) {
  const sourceDir = path.resolve(options.source ?? DEFAULT_SOURCE_DIR);
  const destDir = path.resolve(options.dest ?? getDefaultDestDir());

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source skill directory does not exist: ${sourceDir}`);
  }

  const sourceFiles = collectFileHashes(sourceDir);
  const destStat = lstatOrNull(destDir);
  const destExists = Boolean(destStat);

  if (destStat && (destStat.isSymbolicLink() || !destStat.isDirectory())) {
    return {
      action: 'check',
      sourceDir,
      destDir,
      destExists: true,
      destError: destStat.isSymbolicLink()
        ? 'Destination path is a symlink rather than a regular directory.'
        : 'Destination path exists and is not a directory.',
      inSync: false,
      fileCount: sourceFiles.size,
      missing: [...sourceFiles.keys()],
      modified: [],
      extra: [],
      symlinks: [],
    };
  }

  const destCollected = destExists ? collectEntries(destDir) : { files: new Map(), symlinks: [] };
  const destFiles = destCollected.files;
  const symlinks = destCollected.symlinks;

  const missing = [];
  const modified = [];
  const extra = [];

  for (const [relPath, srcHash] of sourceFiles.entries()) {
    if (!destFiles.has(relPath)) {
      missing.push(relPath);
    } else if (destFiles.get(relPath) !== srcHash) {
      modified.push(relPath);
    }
  }

  for (const relPath of destFiles.keys()) {
    if (!sourceFiles.has(relPath)) {
      extra.push(relPath);
    }
  }

  const inSync =
    destExists &&
    missing.length === 0 &&
    modified.length === 0 &&
    extra.length === 0 &&
    symlinks.length === 0;

  return {
    action: 'check',
    sourceDir,
    destDir,
    destExists,
    destError: null,
    inSync,
    fileCount: sourceFiles.size,
    missing,
    modified,
    extra,
    symlinks,
  };
}

function pruneEmptyDirs(rootDir) {
  if (!fs.existsSync(rootDir)) return;
  for (const name of fs.readdirSync(rootDir)) {
    const absPath = path.join(rootDir, name);
    const stat = fs.lstatSync(absPath);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      pruneEmptyDirs(absPath);
      if (fs.readdirSync(absPath).length === 0) {
        fs.rmdirSync(absPath);
      }
    }
  }
}

export function installSkill(options = {}) {
  const sourceDir = path.resolve(options.source ?? DEFAULT_SOURCE_DIR);
  const destDir = path.resolve(options.dest ?? getDefaultDestDir());
  const dryRun = Boolean(options.dryRun);

  assertSafeDestDir(destDir, sourceDir);
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source skill directory does not exist: ${sourceDir}`);
  }
  if (!fs.existsSync(path.join(sourceDir, 'SKILL.md'))) {
    throw new Error(`Source skill directory is missing SKILL.md: ${sourceDir}`);
  }

  const destStat = lstatOrNull(destDir);
  if (destStat && (destStat.isSymbolicLink() || !destStat.isDirectory())) {
    throw new Error(`Refusing to install into non-directory or symlink destination: ${destDir}`);
  }

  const sourceFiles = collectFileHashes(sourceDir);
  const destCollected = destStat ? collectEntries(destDir) : { files: new Map(), symlinks: [] };
  const destFiles = destCollected.files;
  const destSymlinks = destCollected.symlinks;

  const copied = [];
  const unchanged = [];
  const removed = [];

  // Remove rogue symlinks inside destination (unlink without touching symlink targets)
  for (const relPath of destSymlinks) {
    const dstAbs = path.join(destDir, ...relPath.split('/'));
    if (!dryRun) {
      fs.rmSync(dstAbs, { force: true });
    }
    if (!sourceFiles.has(relPath)) {
      removed.push(relPath);
    }
  }

  for (const [relPath, srcHash] of sourceFiles.entries()) {
    const srcAbs = path.join(sourceDir, ...relPath.split('/'));
    const dstAbs = path.join(destDir, ...relPath.split('/'));
    if (destFiles.get(relPath) === srcHash) {
      unchanged.push(relPath);
      continue;
    }
    if (!dryRun) {
      fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
      const existingDstStat = lstatOrNull(dstAbs);
      if (existingDstStat && (existingDstStat.isSymbolicLink() || existingDstStat.isDirectory())) {
        fs.rmSync(dstAbs, { recursive: true, force: true });
      }
      fs.copyFileSync(srcAbs, dstAbs);
    }
    copied.push(relPath);
  }

  // Remove stale extra files so destination mirrors source cleanly
  for (const relPath of destFiles.keys()) {
    if (!sourceFiles.has(relPath)) {
      const dstAbs = path.join(destDir, ...relPath.split('/'));
      if (!dryRun) {
        fs.rmSync(dstAbs, { force: true });
      }
      removed.push(relPath);
    }
  }

  if (!dryRun && fs.existsSync(destDir)) {
    pruneEmptyDirs(destDir);
  }

  return {
    action: dryRun ? 'install_dry_run' : 'install',
    sourceDir,
    destDir,
    dryRun,
    totalFiles: sourceFiles.size,
    copied,
    unchanged,
    removed,
  };
}

export function uninstallSkill(options = {}) {
  const sourceDir = path.resolve(options.source ?? DEFAULT_SOURCE_DIR);
  const destDir = path.resolve(options.dest ?? getDefaultDestDir());
  const dryRun = Boolean(options.dryRun);

  assertSafeDestDir(destDir, sourceDir);
  const destStat = lstatOrNull(destDir);
  const existed = Boolean(destStat);

  if (destStat && !destStat.isDirectory() && !destStat.isSymbolicLink()) {
    throw new Error(`Refusing to uninstall non-directory path: ${destDir}`);
  }

  if (existed && !dryRun) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }

  return {
    action: dryRun ? 'uninstall_dry_run' : 'uninstall',
    destDir,
    dryRun,
    existed,
    removed: existed && !dryRun,
  };
}

function formatResult(res) {
  if (res.action === 'check') {
    if (res.inSync) {
      return `OK: ${res.destDir} is in sync with ${res.sourceDir} (${res.fileCount} files, zero drift).`;
    }
    const lines = [`DRIFT DETECTED between ${res.sourceDir} and ${res.destDir}:`];
    if (!res.destExists) lines.push('  - Destination directory does not exist.');
    if (res.destError) lines.push(`  - ${res.destError}`);
    for (const f of res.missing) lines.push(`  - missing: ${f}`);
    for (const f of res.modified) lines.push(`  - modified: ${f}`);
    for (const f of res.extra) lines.push(`  - extra: ${f}`);
    for (const f of res.symlinks || []) lines.push(`  - rogue symlink: ${f}`);
    return lines.join('\n');
  }

  if (res.action === 'uninstall' || res.action === 'uninstall_dry_run') {
    if (!res.existed) return `Nothing to uninstall: ${res.destDir} does not exist.`;
    return res.dryRun
      ? `Dry-run: would remove ${res.destDir}`
      : `Uninstalled agy-ignore skill from ${res.destDir}`;
  }

  const lines = [
    `${res.dryRun ? 'Dry-run install' : 'Installed'} agy-ignore -> ${res.destDir}`,
    `  total: ${res.totalFiles}, copied: ${res.copied.length}, unchanged: ${res.unchanged.length}, removed: ${res.removed.length}`,
  ];
  return lines.join('\n');
}

function normalizeModuleUrl(filePath) {
  let resolved = path.resolve(filePath);
  try {
    resolved = fs.realpathSync(resolved);
  } catch {
    // Fall back to lexical resolution if path cannot be realpath'd
  }
  const href = pathToFileURL(resolved).href;
  return process.platform === 'win32' ? href.toLowerCase() : href;
}

function isExecutedDirectly() {
  if (!process.argv[1]) return false;
  return normalizeModuleUrl(fileURLToPath(import.meta.url)) === normalizeModuleUrl(process.argv[1]);
}

if (isExecutedDirectly()) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      process.stdout.write(`${getUsageText()}\n`);
      process.exit(0);
    }

    let res;
    if (opts.check) {
      res = checkSkill(opts);
    } else if (opts.uninstall) {
      res = uninstallSkill(opts);
    } else {
      res = installSkill(opts);
    }

    if (opts.json) {
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatResult(res)}\n`);
    }

    if (opts.check && !res.inSync) {
      process.exit(1);
    }
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}
