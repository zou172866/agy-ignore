import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  auditWorkspace,
  classifyDirectory,
  isSensitiveFile,
  renderMarkdown,
  verifyIgnoreFile,
  renderVerifyMarkdown,
  parseArgs as parseAuditArgs,
} from '../skills/agy-ignore/scripts/audit_workspace.mjs';
import {
  syncIgnores,
  buildSyncedContent,
  parseArgs as parseSyncArgs,
} from '../skills/agy-ignore/scripts/sync_ignores.mjs';
import {
  installSkill,
  checkSkill,
  uninstallSkill,
} from '../scripts/install-local.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..');
const AUDIT_SCRIPT = path.join(REPO_ROOT, 'skills', 'agy-ignore', 'scripts', 'audit_workspace.mjs');
const SYNC_SCRIPT = path.join(REPO_ROOT, 'skills', 'agy-ignore', 'scripts', 'sync_ignores.mjs');
const INSTALL_SCRIPT = path.join(REPO_ROOT, 'scripts', 'install-local.mjs');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFileDeep(root, relPosixPath, content) {
  const full = path.join(root, ...relPosixPath.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

function runGit(cwd, args) {
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test User',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test User',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
  assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout;
}

function runNode(scriptPath, args, cwd = REPO_ROOT) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
}

function buildSyntheticWorkspace() {
  const root = makeTempDir('agy-ignore-ws-');

  // Existing root .antigravityignore
  writeFileDeep(root, '.antigravityignore', '# Existing custom rule\ncustom-ignore-dir/\n');

  // Nested Git repo: sub-scraper
  const scraperDir = path.join(root, 'sub-scraper');
  fs.mkdirSync(scraperDir, { recursive: true });
  runGit(scraperDir, ['init']);

  // Intentionally incomplete .gitignore (misses .edge-profile/, .env, certs/*.pem, output/)
  writeFileDeep(scraperDir, '.gitignore', 'node_modules/\n');
  writeFileDeep(scraperDir, 'package.json', '{"name":"sub-scraper","version":"1.0.0"}\n');
  writeFileDeep(scraperDir, 'package-lock.json', '{"lockfileVersion":3,"packages":{}}\n'.repeat(200));
  writeFileDeep(scraperDir, 'bin/cli.mjs', 'console.log("active cli script");\n');
  writeFileDeep(scraperDir, 'src/index.js', 'export const ok = true;\n');

  // Fake browser profile (unignored + heavy)
  writeFileDeep(scraperDir, '.edge-profile/Local State', '{"os_crypt":{}}\n');
  writeFileDeep(scraperDir, '.edge-profile/Default/Cookies', 'x'.repeat(64 * 1024));
  writeFileDeep(scraperDir, '.edge-profile/Default/Cache/Cache_Data/f_0001', 'y'.repeat(256 * 1024));

  // Sensitive files: .env (tracked!), .env.example (must NOT be flagged), keys, local config.json
  writeFileDeep(scraperDir, '.env', 'API_KEY=dummy_test_value\n');
  writeFileDeep(scraperDir, '.env.example', 'API_KEY=your_key_here\n');
  writeFileDeep(scraperDir, 'certs/dev.pem', '-----BEGIN CERTIFICATE-----\nDUMMY\n-----END CERTIFICATE-----\n');
  writeFileDeep(scraperDir, 'certs/dev.key', '-----BEGIN PRIVATE KEY-----\nDUMMY\n-----END PRIVATE KEY-----\n');
  writeFileDeep(scraperDir, 'config.example.json', '{"endpoint":"https://example.com"}\n');
  writeFileDeep(scraperDir, 'config.json', '{"endpoint":"https://example.com","token":"dummy"}\n');

  // Dependencies and batch output
  for (let i = 0; i < 15; i += 1) {
    writeFileDeep(scraperDir, `node_modules/pkg-${i}/index.js`, `module.exports = ${i};\n`.repeat(10));
  }
  writeFileDeep(scraperDir, 'output/batch-01.csv', 'a,b,c\n'.repeat(500));

  // Stage .env and src/index.js in nested git repo so .env is tracked!
  runGit(scraperDir, ['add', 'src/index.js', '.env', '.gitignore', 'package.json', 'config.example.json']);

  // Unicode CJK ASR/corpus pipeline directory
  for (let i = 1; i <= 25; i += 1) {
    const id = String(i).padStart(3, '0');
    writeFileDeep(root, `语料库/03-chunks/第01课-中文路径/切片_${id}.md`, `# 切片 ${id}\n测试文本内容。\n`.repeat(20));
  }
  writeFileDeep(root, '语料库/01-raw/原始稿_01.md', '原始语音转写文本\n'.repeat(50));
  for (let i = 1; i <= 6; i += 1) {
    writeFileDeep(root, `语料库/04-cleaned/成品_0${i}.md`, `# 成品 ${i}\n精修文稿。\n`.repeat(15));
  }
  writeFileDeep(root, '语料库/05-verify-review/batch1_tmp/temp.json', '{"tmp":true}\n');
  writeFileDeep(root, '语料库/05-verify-review/batch2_tmp/temp.json', '{"tmp":true}\n');
  writeFileDeep(root, '语料库/05-verify-review/final_report.md', '# Verification Report\n');

  // Historical release archive folder
  writeFileDeep(root, 'demo-releases/v1.0.0.zip', Buffer.alloc(128 * 1024, 0x50));

  // Directory symlink loop pointing back to workspace root
  const loopLink = path.join(root, 'loop-link');
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(root, loopLink, linkType);

  return root;
}

test('auditWorkspace detects bloat, CJK paths, sensitive files, git leaks, and survives symlink loops', () => {
  const ws = buildSyntheticWorkspace();
  try {
    const report = auditWorkspace(ws, { top: 15, maxDepth: 6 });

    // Overview & symlink safety
    assert.ok(report.overview.totalFiles > 50, 'should count real files across workspace');
    assert.ok(report.overview.skippedSymlinks >= 1, 'should skip directory symlink loop without hanging');
    assert.ok(report.overview.detectedStacks.includes('Node.js / TypeScript'));
    assert.ok(report.overview.detectedStacks.includes('Browser Automation'));
    assert.ok(report.overview.detectedStacks.includes('AI / Data Corpus'));

    // Existing .antigravityignore detected
    assert.ok(
      report.overview.existingIgnoreFiles.some(
        (f) => f.scope === 'root' && f.name === '.antigravityignore'
      ),
      'should detect existing root .antigravityignore'
    );

    // Top bloat & noise categories
    const allTop = [...report.topBySize, ...report.topByFileCount];
    const edgeProfile = allTop.find((d) => d.path === 'sub-scraper/.edge-profile');
    assert.ok(edgeProfile, 'should include sub-scraper/.edge-profile in top bloat dirs');
    assert.equal(edgeProfile.category, 'browser_profile');

    const chunksDir = allTop.find((d) => d.path === '语料库/03-chunks');
    assert.ok(chunksDir, 'should include CJK 语料库/03-chunks in top bloat dirs');
    assert.equal(chunksDir.category, 'corpus_or_intermediate');
    assert.equal(chunksDir.files, 25);

    const releasesDir = allTop.find((d) => d.path === 'demo-releases');
    assert.ok(releasesDir, 'should detect demo-releases');
    assert.equal(releasesDir.category, 'archives_releases');

    // Node bin/ should NOT be misclassified as build_cache
    const nodeBin = allTop.find((d) => d.path === 'sub-scraper/bin');
    assert.ok(!nodeBin || nodeBin.category !== 'build_cache', 'sub-scraper/bin must not be classified as build_cache');

    // Lockfile detection
    assert.ok(
      report.lockfiles.some((l) => l.path === 'sub-scraper/package-lock.json'),
      'should detect sub-scraper/package-lock.json'
    );

    // Sensitive files detection (and .env.example exclusion!)
    const sensitivePaths = new Set(report.sensitiveItems.map((s) => s.path));
    assert.ok(sensitivePaths.has('sub-scraper/.edge-profile'), 'browser profile should be flagged as sensitive');
    assert.ok(sensitivePaths.has('sub-scraper/.env'), '.env should be flagged as sensitive');
    assert.ok(!sensitivePaths.has('sub-scraper/.env.example'), '.env.example must NOT be flagged as sensitive');
    assert.ok(sensitivePaths.has('sub-scraper/certs/dev.pem'), 'dev.pem should be flagged as sensitive');
    assert.ok(sensitivePaths.has('sub-scraper/certs/dev.key'), 'dev.key should be flagged as sensitive');
    assert.ok(sensitivePaths.has('sub-scraper/config.json'), 'paired config.json should be flagged as sensitive');

    // .gitignore leak detection across nested repo
    assert.ok(report.gitRepos.some((r) => r.repo === 'sub-scraper'));

    const envLeak = report.gitLeaks.find(
      (l) => l.repo === 'sub-scraper' && l.path === '.env'
    );
    assert.ok(envLeak, 'should catch sub-scraper/.env gitignore leak');
    assert.equal(envLeak.ignoredByGitignore, false);
    assert.equal(envLeak.isTracked, true, '.env was git-added and must be flagged as tracked');
    assert.equal(envLeak.action, 'add_to_gitignore_and_untrack');

    const profileLeak = report.gitLeaks.find(
      (l) => l.repo === 'sub-scraper' && l.path === '.edge-profile'
    );
    assert.ok(profileLeak, 'should catch unignored sub-scraper/.edge-profile');
    assert.equal(profileLeak.ignoredByGitignore, false);
    assert.equal(profileLeak.isTracked, false);

    // node_modules IS ignored in sub-scraper/.gitignore, so must NOT appear as a leak
    const nmLeak = report.gitLeaks.find(
      (l) => l.repo === 'sub-scraper' && l.path === 'node_modules'
    );
    assert.equal(nmLeak, undefined, 'properly gitignored node_modules/ should not be reported as leak');

    // Quantitative savings sanity (non-NaN, 0..100%)
    assert.ok(report.savings.fileReductionPct > 0 && report.savings.fileReductionPct <= 100);
    assert.ok(report.savings.sizeReductionPct > 0 && report.savings.sizeReductionPct <= 100);

    // Draft quality & safety invariants
    const draft = report.recommendations.antigravityIgnoreDraft;
    assert.match(draft, /MERGE incrementally/);
    assert.match(draft, /sub-scraper\/\.edge-profile\//);
    assert.match(draft, /语料库\/03-chunks\//);
    assert.match(draft, /语料库\/05-verify-review\/\*_tmp\//);
    assert.match(draft, /# 语料库\/04-cleaned\//, 'borderline 04-cleaned should be a commented toggle');
    assert.match(draft, /!\.env\.example/);

    // Must never emit blanket *.png / *.svg / *.json / *.md active rules
    const activeDraftLines = draft
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    for (const forbidden of ['*.png', '*.svg', '*.json', '*.md']) {
      assert.ok(
        !activeDraftLines.includes(forbidden),
        `draft must never include blanket rule "${forbidden}"`
      );
    }

    // Layer 1 permissions.deny snippet includes detected browser profile & local config
    const deny = report.recommendations.permissionsDeny.permissions.deny;
    assert.ok(deny.includes('Read(sub-scraper/.edge-profile/**)'));
    assert.ok(deny.includes('Read(sub-scraper/config.json)'));

    // Markdown rendering
    const md = renderMarkdown(report);
    assert.match(md, /# Workspace Context & Ignore Audit Report/);
    assert.match(md, /sub-scraper\/\.edge-profile\//);
    assert.match(md, /语料库\/03-chunks\//);
    assert.match(md, /git rm --cached -- "\.env"/);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('audit_workspace.mjs CLI works with --format json, --json, --format md, empty dir, and rejects bad args', () => {
  const ws = buildSyntheticWorkspace();
  const emptyDir = makeTempDir('agy-ignore-empty-');
  try {
    // --format json
    const jsonRes = runNode(AUDIT_SCRIPT, [ws, '--format', 'json', '--top', '8', '--max-depth', '5']);
    assert.equal(jsonRes.status, 0, jsonRes.stderr);
    const parsed = JSON.parse(jsonRes.stdout);
    assert.equal(parsed.overview.maxDepth, 5);
    assert.ok(parsed.topBySize.length <= 8);

    // --json shorthand
    const shortRes = runNode(AUDIT_SCRIPT, [ws, '--json']);
    assert.equal(shortRes.status, 0, shortRes.stderr);
    const parsedShort = JSON.parse(shortRes.stdout);
    assert.ok(parsedShort.overview.totalFiles > 0);

    // --format md
    const mdRes = runNode(AUDIT_SCRIPT, [ws, '--format', 'md']);
    assert.equal(mdRes.status, 0, mdRes.stderr);
    assert.match(mdRes.stdout, /## 1\. Workspace Overview/);
    assert.match(mdRes.stdout, /## 9\. Hard Security Wall Snippet/);

    // Empty directory edge case (zero division / NaN guard)
    const emptyRes = runNode(AUDIT_SCRIPT, [emptyDir, '--json']);
    assert.equal(emptyRes.status, 0, emptyRes.stderr);
    const emptyParsed = JSON.parse(emptyRes.stdout);
    assert.equal(emptyParsed.overview.totalFiles, 0);
    assert.equal(emptyParsed.savings.fileReductionPct, 0);
    assert.equal(emptyParsed.savings.sizeReductionPct, 0);

    // Invalid flag / missing targetDir
    assert.throws(() => parseAuditArgs(['--format', 'xml']));
    assert.throws(() => parseAuditArgs(['--top', '0']));
    const badRes = runNode(AUDIT_SCRIPT, [path.join(emptyDir, 'does-not-exist')]);
    assert.notEqual(badRes.status, 0);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});

test('sync_ignores.mjs handles dry-run, creation, idempotency, conflict protection, backup, and force', () => {
  const ws = makeTempDir('agy-ignore-sync-');
  try {
    const sourceContent = '# Custom rules\nnode_modules/\n.edge-profile/\n';
    writeFileDeep(ws, '.antigravityignore', sourceContent);

    // 1. --dry-run does not create files
    const dryRes = syncIgnores(ws, { dryRun: true, targets: ['.geminiignore', '.aiexclude'] });
    assert.equal(dryRes.hasConflicts, false);
    assert.equal(dryRes.results[0].action, 'would_create');
    assert.equal(fs.existsSync(path.join(ws, '.geminiignore')), false);
    assert.equal(fs.existsSync(path.join(ws, '.aiexclude')), false);

    // 2. Real sync via CLI creates both targets with generated header
    const cliCreate = runNode(SYNC_SCRIPT, [ws, '--targets', '.geminiignore,.aiexclude']);
    assert.equal(cliCreate.status, 0, cliCreate.stderr);
    const geminiContent = fs.readFileSync(path.join(ws, '.geminiignore'), 'utf8');
    const aiexcludeContent = fs.readFileSync(path.join(ws, '.aiexclude'), 'utf8');
    assert.equal(geminiContent, buildSyncedContent(sourceContent));
    assert.equal(aiexcludeContent, buildSyncedContent(sourceContent));
    assert.match(geminiContent, /AUTO-GENERATED by agy-ignore/);
    assert.match(geminiContent, /Source: \.antigravityignore/);

    // 3. Re-running with identical content is idempotent
    const secondRun = syncIgnores(ws, { targets: ['.geminiignore', '.aiexclude'] });
    assert.equal(secondRun.hasConflicts, false);
    assert.ok(secondRun.results.every((r) => r.action === 'unchanged'));

    // 4. Hand-edit .geminiignore -> without --force/--backup, CLI refuses to clobber and exits 1
    const manualContent = '# User handwritten .geminiignore\nmy-secret-dir/\n';
    writeFileDeep(ws, '.geminiignore', manualContent);
    const conflictRun = runNode(SYNC_SCRIPT, [ws, '--targets', '.geminiignore']);
    assert.equal(conflictRun.status, 1);
    assert.equal(fs.readFileSync(path.join(ws, '.geminiignore'), 'utf8'), manualContent);

    // 5. With --backup -> creates backup containing original content and updates target
    const backupRun = runNode(SYNC_SCRIPT, [ws, '--targets', '.geminiignore', '--backup', '--json']);
    assert.equal(backupRun.status, 0, backupRun.stderr);
    const backupJson = JSON.parse(backupRun.stdout);
    assert.equal(backupJson.results[0].action, 'backed_up_and_updated');
    const backupPath = backupJson.results[0].backupPath;
    assert.ok(backupPath && fs.existsSync(backupPath));
    assert.equal(fs.readFileSync(backupPath, 'utf8'), manualContent);
    assert.equal(fs.readFileSync(path.join(ws, '.geminiignore'), 'utf8'), buildSyncedContent(sourceContent));

    // 6. With --force -> overwrites directly without backup
    writeFileDeep(ws, '.aiexclude', '# Old content\n');
    const forceRun = runNode(SYNC_SCRIPT, [ws, '--targets', '.aiexclude', '--force']);
    assert.equal(forceRun.status, 0, forceRun.stderr);
    assert.equal(fs.readFileSync(path.join(ws, '.aiexclude'), 'utf8'), buildSyncedContent(sourceContent));

    // 7. Missing source fails cleanly
    fs.rmSync(path.join(ws, '.antigravityignore'));
    const missingSrc = runNode(SYNC_SCRIPT, [ws]);
    assert.notEqual(missingSrc.status, 0);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('install-local.mjs handles dry-run, install, --check drift detection, clean mirror sync, and --uninstall', () => {
  const sandbox = makeTempDir('agy-ignore-install-');
  const dest = path.join(sandbox, 'skills', 'agy-ignore');
  try {
    // 1. Dry run does not write destination
    const dryRes = installSkill({ dest, dryRun: true });
    assert.equal(dryRes.action, 'install_dry_run');
    assert.equal(dryRes.copied.length, 4);
    assert.equal(fs.existsSync(dest), false);

    // 2. Check before install reports drift (missing dest)
    const preCheck = runNode(INSTALL_SCRIPT, ['--dest', dest, '--check']);
    assert.equal(preCheck.status, 1);

    // 3. Install via CLI
    const instCli = runNode(INSTALL_SCRIPT, ['--dest', dest]);
    assert.equal(instCli.status, 0, instCli.stderr);
    assert.equal(fs.existsSync(path.join(dest, 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(dest, 'scripts', 'audit_workspace.mjs')), true);
    assert.equal(fs.existsSync(path.join(dest, 'scripts', 'sync_ignores.mjs')), true);
    assert.equal(fs.existsSync(path.join(dest, 'references', 'guardrails.md')), true);
    assert.equal(fs.existsSync(path.join(dest, 'references', 'three-layer-defense.md')), false);
    assert.equal(fs.existsSync(path.join(dest, 'references', 'stack-patterns.md')), false);

    // 4. --check passes with zero drift
    const okCheck = runNode(INSTALL_SCRIPT, ['--dest', dest, '--check']);
    assert.equal(okCheck.status, 0, okCheck.stderr);
    assert.match(okCheck.stdout, /zero drift/i);

    // 5. Modify an installed file -> --check catches modified drift
    fs.appendFileSync(path.join(dest, 'SKILL.md'), '\n<!-- drift -->\n');
    const modCheck = checkSkill({ dest });
    assert.equal(modCheck.inSync, false);
    assert.deepEqual(modCheck.modified, ['SKILL.md']);

    // 6. Add an extra rogue file -> --check catches extra file; re-install mirrors cleanly
    writeFileDeep(dest, 'stale/extra.txt', 'stale');
    const extraCheck = checkSkill({ dest });
    assert.equal(extraCheck.inSync, false);
    assert.ok(extraCheck.extra.includes('stale/extra.txt'));

    const resync = installSkill({ dest });
    assert.ok(resync.removed.includes('stale/extra.txt'));
    assert.equal(checkSkill({ dest }).inSync, true);

    // 7. Delete a file -> --check catches missing file
    fs.rmSync(path.join(dest, 'references', 'guardrails.md'));
    const missingCheck = checkSkill({ dest });
    assert.equal(missingCheck.inSync, false);
    assert.deepEqual(missingCheck.missing, ['references/guardrails.md']);

    // 8. Uninstall via CLI removes destination cleanly
    const uninstCli = runNode(INSTALL_SCRIPT, ['--dest', dest, '--uninstall']);
    assert.equal(uninstCli.status, 0, uninstCli.stderr);
    assert.equal(fs.existsSync(dest), false);

    // 9. Second uninstall is graceful no-op
    const secondUninst = uninstallSkill({ dest });
    assert.equal(secondUninst.existed, false);

    // 10. Safety guard: refuse to uninstall or install over source directory itself
    const sourceDir = path.join(REPO_ROOT, 'skills', 'agy-ignore');
    assert.throws(() => uninstallSkill({ dest: sourceDir }), /source skill directory/i);
    assert.throws(() => installSkill({ dest: sourceDir }), /source skill directory/i);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('auditWorkspace isolates root vs nested repos, detects tracked-despite-gitignore, gitignored config.json, CJK git paths, and respects --max-depth', () => {
  const root = makeTempDir('agy-ignore-edge-');
  try {
    // Root Git repo
    runGit(root, ['init']);
    writeFileDeep(root, '.gitignore', 'ignored-tracked.key\nlocal-only/config.json\n');
    writeFileDeep(root, 'ignored-tracked.key', 'DUMMY KEY\n');
    writeFileDeep(root, 'local-only/config.json', '{"secret":"dummy"}\n');
    writeFileDeep(root, '秘密目录/.env', 'TOKEN=cjk_secret\n');
    writeFileDeep(root, 'deep/l2/l3/l4/leaf.txt', 'deep file\n');

    // Force-add an ignored key file so it is BOTH gitignored AND tracked
    runGit(root, ['add', '.gitignore']);
    runGit(root, ['add', '-f', 'ignored-tracked.key']);

    // Nested Git repo inside root repo
    const nested = path.join(root, 'nested-app');
    fs.mkdirSync(nested, { recursive: true });
    runGit(nested, ['init']);
    writeFileDeep(nested, '.gitignore', '');
    writeFileDeep(nested, 'secrets/api.pem', 'DUMMY PEM\n');

    const report = auditWorkspace(root, { maxDepth: 6 });

    // Root & nested repo both scanned, leaks attributed to correct owner
    assert.ok(report.gitRepos.some((r) => r.repo === '.'));
    assert.ok(report.gitRepos.some((r) => r.repo === 'nested-app'));

    const trackedDespiteIgnore = report.gitLeaks.find(
      (l) => l.repo === '.' && l.path === 'ignored-tracked.key'
    );
    assert.ok(trackedDespiteIgnore, 'should catch tracked file even though .gitignore matches it');
    assert.equal(trackedDespiteIgnore.ignoredByGitignore, true);
    assert.equal(trackedDespiteIgnore.isTracked, true);
    assert.equal(trackedDespiteIgnore.action, 'untrack_already_tracked');

    // CJK path leak in root git repo
    const cjkLeak = report.gitLeaks.find(
      (l) => l.repo === '.' && l.path === '秘密目录/.env'
    );
    assert.ok(cjkLeak, 'should detect CJK path leak via git check-ignore');
    assert.equal(cjkLeak.ignoredByGitignore, false);

    // Nested repo owns nested-app/secrets, NOT root repo
    const nestedLeak = report.gitLeaks.find(
      (l) => l.repo === 'nested-app' && l.path === 'secrets'
    );
    assert.ok(nestedLeak, 'nested repo should own nested-app/secrets');
    const rootMisattributed = report.gitLeaks.find(
      (l) => l.repo === '.' && l.workspacePath.startsWith('nested-app/')
    );
    assert.equal(rootMisattributed, undefined, 'root repo must not claim leaks inside nested repo');

    // Gitignored config.json without config.example.json promoted to sensitiveItems
    assert.ok(
      report.sensitiveItems.some(
        (s) => s.path === 'local-only/config.json' && s.category === 'local_config'
      ),
      'gitignored local config.json should be promoted to sensitiveItems'
    );

    // Strict --max-depth 2 truncates deep/l2/l3
    const shallowReport = auditWorkspace(root, { maxDepth: 2 });
    assert.ok(shallowReport.overview.truncatedDirs >= 1, 'maxDepth=2 should truncate deep nested dirs');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('skills/agy-ignore/ meets slimming budgets (4-file layout, concise SKILL.md, single guardrails.md, valid relative links)', () => {
  const skillRoot = path.join(REPO_ROOT, 'skills', 'agy-ignore');
  const measure = (relPath) => {
    const abs = path.join(skillRoot, ...relPath.split('/'));
    const content = fs.readFileSync(abs, 'utf8');
    return { content, lines: content.trimEnd().split(/\r?\n/).length, bytes: fs.statSync(abs).size };
  };

  // 1. SKILL.md budget & frontmatter description <= 220 chars
  const skill = measure('SKILL.md');
  assert.ok(skill.lines <= 58, `SKILL.md should be <= 58 lines, got ${skill.lines}`);
  assert.ok(skill.bytes <= 2600, `SKILL.md should be <= 2600 bytes, got ${skill.bytes}`);
  assert.match(skill.content, /^---\r?\nname:\s*agy-ignore\r?\n/);

  const fmMatch = skill.content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(fmMatch, 'SKILL.md must have YAML frontmatter');
  const descMatch = fmMatch[1].match(/^description:\s*(?:>-?\r?\n((?:[ \t]+.+\r?\n?)+)|(.+))$/m);
  assert.ok(descMatch, 'SKILL.md frontmatter must declare description');
  const description = (descMatch[1] ? descMatch[1].replace(/\r?\n[ \t]+/g, ' ') : descMatch[2]).trim();
  assert.ok(
    description.length > 0 && description.length <= 220,
    `SKILL.md description should be 1..220 chars, got ${description.length}`
  );

  // 2. Single references/guardrails.md (old reference files removed)
  const refsDir = path.join(skillRoot, 'references');
  assert.deepEqual(fs.readdirSync(refsDir).sort(), ['guardrails.md']);
  assert.equal(fs.existsSync(path.join(refsDir, 'three-layer-defense.md')), false);
  assert.equal(fs.existsSync(path.join(refsDir, 'stack-patterns.md')), false);
  const guardrails = measure('references/guardrails.md');
  assert.ok(guardrails.lines <= 65, `guardrails.md should be <= 65 lines, got ${guardrails.lines}`);
  assert.ok(guardrails.bytes <= 2700, `guardrails.md should be <= 2700 bytes, got ${guardrails.bytes}`);

  // 3. Script slimming budgets (readable, non-minified ESM)
  // Note: v1.2.0 adds isolated --verify, preventive .gitignore hardening, AI weights & runtime state detection.
  const auditScript = measure('scripts/audit_workspace.mjs');
  assert.ok(auditScript.lines <= 760, `audit_workspace.mjs should be <= 760 lines, got ${auditScript.lines}`);
  assert.ok(auditScript.bytes <= 38912, `audit_workspace.mjs should be <= 38912 bytes, got ${auditScript.bytes}`);

  const syncScript = measure('scripts/sync_ignores.mjs');
  assert.ok(syncScript.lines <= 155, `sync_ignores.mjs should be <= 155 lines, got ${syncScript.lines}`);
  assert.ok(syncScript.bytes <= 5632, `sync_ignores.mjs should be <= 5632 bytes, got ${syncScript.bytes}`);

  // 4. All markdown links in SKILL.md are relative, stay inside skills/agy-ignore/, and resolve
  const linkMatches = [...skill.content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(linkMatches.length >= 3, `SKILL.md should have >= 3 relative links, got ${linkMatches.length}`);
  for (const target of linkMatches) {
    assert.ok(
      target.startsWith('./'),
      `All links in SKILL.md must be relative (./...), found: "${target}"`
    );
    const resolved = path.resolve(skillRoot, target);
    assert.ok(
      resolved.startsWith(skillRoot),
      `Link "${target}" escapes skill directory`
    );
    assert.equal(
      fs.existsSync(resolved),
      true,
      `Relative link target does not exist: ${target}`
    );
  }
});

test('CLIs execute cleanly when invoked through a symlinked skill directory (npx skills add layout)', () => {
  const tmp = makeTempDir('agy-ignore-symlink-cli-');
  try {
    const ws = path.join(tmp, 'ws');
    writeFileDeep(ws, 'index.js', 'export const x = 1;\n');
    writeFileDeep(ws, '.antigravityignore', 'node_modules/\n');

    const linkedSkillDir = path.join(tmp, 'linked-skill');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(path.join(REPO_ROOT, 'skills', 'agy-ignore'), linkedSkillDir, linkType);

    const auditViaLink = runNode(path.join(linkedSkillDir, 'scripts', 'audit_workspace.mjs'), [ws, '--json']);
    assert.equal(auditViaLink.status, 0, auditViaLink.stderr);
    const auditJson = JSON.parse(auditViaLink.stdout);
    assert.equal(auditJson.overview.totalFiles, 2);

    const syncViaLink = runNode(path.join(linkedSkillDir, 'scripts', 'sync_ignores.mjs'), [ws, '--dry-run', '--json']);
    assert.equal(syncViaLink.status, 0, syncViaLink.stderr);
    const syncJson = JSON.parse(syncViaLink.stdout);
    assert.equal(syncJson.results.length, 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('auditWorkspace isolates root node_modules, handles polyglot bin/env scoping, protects repos named build/, and aligns draft/deny with detected secrets and extensions', () => {
  const ws = makeTempDir('agy-ignore-regression-');
  try {
    // Root node_modules should NOT pollute existingIgnoreFiles, detectedStacks, or topBySize subdirs
    writeFileDeep(ws, 'package.json', '{"name":"polyglot-root"}\n');
    writeFileDeep(ws, 'node_modules/fake-pkg/.gitignore', 'dist/\n');
    writeFileDeep(ws, 'node_modules/fake-pkg/Cargo.toml', '[package]\nname="fake"\n');
    writeFileDeep(ws, 'node_modules/fake-pkg/setup.py', 'print(1)\n');

    // Polyglot Node CLI bin/ + .NET bin/obj + Python venv named env/
    writeFileDeep(ws, 'node-cli/package.json', '{"name":"cli"}\n');
    writeFileDeep(ws, 'node-cli/bin/cli.mjs', 'console.log("keep");\n');
    writeFileDeep(ws, 'dotnet-app/App.csproj', '<Project />\n');
    writeFileDeep(ws, 'dotnet-app/bin/Debug/app.dll', 'dll-binary');
    writeFileDeep(ws, 'dotnet-app/obj/app.obj', 'obj-binary');
    writeFileDeep(ws, 'py-svc/env/pyvenv.cfg', 'home = /usr/bin\n');
    writeFileDeep(ws, 'py-svc/env/lib/mod.py', 'x = 1\n');

    // Source git repo literally named build/ must NOT be classified as build_cache
    const buildRepo = path.join(ws, 'build');
    fs.mkdirSync(buildRepo, { recursive: true });
    runGit(buildRepo, ['init']);
    writeFileDeep(ws, 'build/package.json', '{"name":"build-tools"}\n');
    writeFileDeep(ws, 'build/src/index.js', 'export const tool = true;\n');

    // Additional sensitive keys & counted extensions (id_rsa, *.pfx, *.sqlite, *.webm, *.bz2)
    writeFileDeep(ws, 'keys/id_rsa', 'PRIVATE KEY\n');
    writeFileDeep(ws, 'certs/app.pfx', 'PFX\n');
    writeFileDeep(ws, 'local.sqlite', 'x'.repeat(2048));
    writeFileDeep(ws, 'clip.webm', 'x'.repeat(2048));
    writeFileDeep(ws, 'bundle.bz2', 'x'.repeat(2048));

    const report = auditWorkspace(ws, { top: 15, maxDepth: 6 });

    // 1. node_modules isolation
    assert.ok(
      !report.overview.existingIgnoreFiles.some((f) => f.path.startsWith('node_modules/')),
      'node_modules/*/.gitignore must not pollute existingIgnoreFiles'
    );
    assert.ok(
      !report.overview.detectedStacks.includes('Rust'),
      'node_modules/*/Cargo.toml must not falsely detect Rust'
    );
    assert.ok(
      !report.topBySize.some((d) => d.path.startsWith('node_modules/')),
      'node_modules subpackages must not crowd out topBySize'
    );

    // 2. Polyglot bin/ and env/ scoping (no global bin/ or env/)
    const activeLines = report.recommendations.antigravityIgnoreDraft
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    assert.ok(!activeLines.includes('bin/'), 'must never emit global bin/ in polyglot workspace');
    assert.ok(!activeLines.includes('env/'), 'must never emit global env/ in polyglot workspace');
    assert.ok(activeLines.includes('dotnet-app/bin/'), 'should scope .NET bin/ to dotnet-app/bin/');
    assert.ok(activeLines.includes('py-svc/env/'), 'should scope Python venv env/ to py-svc/env/');

    // 3. Git repo named build/ is project_container, not build_cache
    const buildDir = report.topBySize.find((d) => d.path === 'build');
    assert.ok(buildDir);
    assert.equal(buildDir.category, 'project_container');

    // 4. Detected non-PEM keys and extra extensions appear in draft and permissions.deny
    assert.ok(activeLines.includes('*.pfx'));
    assert.ok(activeLines.includes('keys/id_rsa'));
    assert.ok(activeLines.includes('*.sqlite'));
    assert.ok(activeLines.includes('*.webm'));
    assert.ok(activeLines.includes('*.bz2'));

    const deny = report.recommendations.permissionsDeny.permissions.deny;
    assert.ok(deny.includes('Read(**/*.pfx)'));
    assert.ok(deny.includes('Read(keys/id_rsa)'));

    // 5. Invalid JS options rejected cleanly
    assert.throws(() => auditWorkspace(ws, { top: 0 }));
    assert.throws(() => auditWorkspace(ws, { maxDepth: 0 }));
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('auditWorkspace handles tracked+gitignored config.json, depth-3 nested repos, broken .git dirs, git worktrees, special-char escaping, no-git PATH, and unreadable dirs', () => {
  const tmp = makeTempDir('agy-ignore-git-edge-');
  try {
    // 1. Tracked + gitignored config.json + depth-3 nested repo + special-char paths
    const ws1 = path.join(tmp, 'ws1');
    fs.mkdirSync(ws1);
    runGit(ws1, ['init']);
    writeFileDeep(ws1, '.gitignore', 'local/config.json\n');
    writeFileDeep(ws1, 'local/config.json', '{"token":"secret"}\n');
    writeFileDeep(ws1, 'dir`with`ticks/.env', 'S=1\n');
    writeFileDeep(ws1, 'dir with spaces/.env', 'S=2\n');
    runGit(ws1, ['add', '.gitignore', 'dir`with`ticks/.env', 'dir with spaces/.env']);
    runGit(ws1, ['add', '-f', 'local/config.json']);

    // Depth-3 nested git repo inside root repo must NOT be blamed on root repo
    const deepSub = path.join(ws1, 'a', 'b', 'subrepo');
    fs.mkdirSync(deepSub, { recursive: true });
    runGit(deepSub, ['init']);
    writeFileDeep(ws1, 'a/b/subrepo/.env', 'SUB=1\n');

    const r1 = auditWorkspace(ws1, { maxDepth: 6 });
    const trackedCfgLeak = r1.gitLeaks.find((l) => l.repo === '.' && l.path === 'local/config.json');
    assert.ok(trackedCfgLeak, 'tracked + gitignored config.json must be caught in gitLeaks');
    assert.equal(trackedCfgLeak.ignoredByGitignore, true);
    assert.equal(trackedCfgLeak.isTracked, true);
    assert.equal(trackedCfgLeak.action, 'untrack_already_tracked');

    assert.equal(
      r1.gitLeaks.find((l) => l.workspacePath.startsWith('a/b/subrepo/')),
      undefined,
      'depth-3 nested repo files must not be attributed to root repo'
    );
    assert.deepEqual(r1.overview.skippedDeepGitRepos, ['a/b/subrepo']);

    // Backtick command escaping & Markdown table safety
    const rootPatch = r1.recommendations.gitignorePatches.find((p) => p.repo === '.');
    assert.ok(
      rootPatch.untrackCommands.some((c) => c.includes('dir\\`with\\`ticks/.env')),
      'backticks in git rm commands must be escaped inside double quotes'
    );
    const md1 = renderMarkdown(r1);
    assert.match(md1, /``dir`with`ticks\/``/);

    // 2. Broken / invalid .git directory reports repo error instead of false-positive leaks
    const wsBroken = path.join(tmp, 'ws-broken-git');
    fs.mkdirSync(path.join(wsBroken, '.git'), { recursive: true });
    writeFileDeep(wsBroken, '.gitignore', '.env\n');
    writeFileDeep(wsBroken, '.env', 'X=1\n');
    const rBroken = auditWorkspace(wsBroken);
    assert.equal(rBroken.gitLeaks.length, 0, 'broken .git repo must not fabricate false-positive leaks');
    assert.ok(rBroken.gitRepos[0]?.error, 'broken .git repo should record error reason');

    // 3. Git worktree (.git file instead of .git directory)
    const wtMain = path.join(tmp, 'wt-main');
    fs.mkdirSync(wtMain);
    runGit(wtMain, ['init']);
    writeFileDeep(wtMain, 'README.md', '# main\n');
    runGit(wtMain, ['add', 'README.md']);
    runGit(wtMain, ['commit', '-m', 'init']);
    const wtDir = path.join(tmp, 'wt-linked');
    runGit(wtMain, ['worktree', 'add', '-b', 'wt-branch', wtDir]);
    writeFileDeep(wtDir, '.env', 'WT=1\n');
    const rWt = auditWorkspace(wtDir);
    assert.ok(rWt.gitLeaks.some((l) => l.repo === '.' && l.path === '.env'));

    // 4. Graceful fallback when git is absent from PATH
    const noGitRes = spawnSync(process.execPath, [AUDIT_SCRIPT, ws1, '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        PATH: path.dirname(process.execPath),
        Path: path.dirname(process.execPath),
        SystemRoot: process.env.SystemRoot || '',
      },
    });
    assert.equal(noGitRes.status, 0, noGitRes.stderr);
    const noGitJson = JSON.parse(noGitRes.stdout);
    assert.equal(noGitJson.overview.gitAvailable, false);
    assert.equal(noGitJson.gitLeaks.length, 0);

    // 5. Permission-denied directory traversal resilience
    const wsPerm = path.join(tmp, 'ws-perm');
    const lockedDir = path.join(wsPerm, 'locked');
    writeFileDeep(wsPerm, 'ok.txt', 'ok\n');
    writeFileDeep(wsPerm, 'locked/secret.txt', 'hidden\n');
    let locked = false;
    try {
      if (process.platform === 'win32') {
        const deny = spawnSync('icacls', [lockedDir, '/deny', `${os.userInfo().username}:(OI)(CI)(F)`], {
          encoding: 'utf8',
          windowsHide: true,
        });
        locked = deny.status === 0;
      } else if (process.getuid && process.getuid() !== 0) {
        fs.chmodSync(lockedDir, 0o000);
        locked = true;
      }
      if (locked) {
        const rPerm = auditWorkspace(wsPerm);
        assert.ok(rPerm.overview.permissionErrors >= 1, 'should record permission errors without crashing');
        assert.equal(rPerm.overview.totalFiles, 1);
      }
    } finally {
      if (locked) {
        if (process.platform === 'win32') {
          spawnSync('icacls', [lockedDir, '/remove:d', os.userInfo().username], {
            encoding: 'utf8',
            windowsHide: true,
          });
        } else {
          fs.chmodSync(lockedDir, 0o755);
        }
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('sync_ignores.mjs and install-local.mjs enforce safety guards, reject bad CLI flags, and catch rogue symlinks', () => {
  const tmp = makeTempDir('agy-ignore-guards-');
  try {
    // 1. sync_ignores: Windows case-insensitive same-as-source, missing flag value, directory target, non-colliding rapid backups
    const wsSync = path.join(tmp, 'sync-ws');
    writeFileDeep(wsSync, '.antigravityignore', 'node_modules/\n');

    if (process.platform === 'win32') {
      const selfCase = syncIgnores(wsSync, { targets: ['.ANTIGRAVITYIGNORE'], force: true });
      assert.equal(selfCase.results[0].action, 'skipped_same_as_source');
      assert.equal(fs.readFileSync(path.join(wsSync, '.antigravityignore'), 'utf8'), 'node_modules/\n');
    }

    const badFlag = runNode(SYNC_SCRIPT, [wsSync, '--targets', '--dry-run']);
    assert.notEqual(badFlag.status, 0);
    assert.equal(fs.existsSync(path.join(wsSync, '--dry-run')), false);

    fs.mkdirSync(path.join(wsSync, '.geminiignore'));
    assert.throws(() => syncIgnores(wsSync, { targets: ['.geminiignore'] }), /not a regular file/i);

    writeFileDeep(wsSync, '.aiexclude', 'v1\n');
    const b1 = syncIgnores(wsSync, { targets: ['.aiexclude'], backup: true });
    writeFileDeep(wsSync, '.aiexclude', 'v2\n');
    const b2 = syncIgnores(wsSync, { targets: ['.aiexclude'], backup: true });
    writeFileDeep(wsSync, '.aiexclude', 'v3\n');
    const b3 = syncIgnores(wsSync, { targets: ['.aiexclude'], backup: true });
    assert.equal(new Set([b1.results[0].backupPath, b2.results[0].backupPath, b3.results[0].backupPath]).size, 3);

    // Symlinked parent directory escape guard, prototype-safe parseArgs, first-occurrence dedupe, and CLI text output
    const outsideSync = path.join(tmp, 'sync-outside');
    fs.mkdirSync(outsideSync, { recursive: true });
    fs.symlinkSync(outsideSync, path.join(wsSync, 'escape-dir'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => syncIgnores(wsSync, { targets: ['escape-dir/.geminiignore'] }), /parent/i);
    assert.equal(fs.existsSync(path.join(outsideSync, '.geminiignore')), false);

    const protoParsed = parseSyncArgs(['constructor']);
    assert.equal(protoParsed.workspaceDir, 'constructor');
    assert.equal(Object.hasOwn(protoParsed, String(Object)), false);
    if (process.platform === 'win32') {
      assert.deepEqual(parseSyncArgs(['--targets', '.geminiignore,.GEMINIIGNORE']).targets, ['.geminiignore']);
    }

    writeFileDeep(wsSync, '.aiexclude', 'manual-conflict\n');
    const conflictCli = runNode(SYNC_SCRIPT, [wsSync, '--targets', '.aiexclude']);
    assert.equal(conflictCli.status, 1);
    assert.match(conflictCli.stdout, /--backup\/--force/);
    const backupCli = runNode(SYNC_SCRIPT, [wsSync, '--targets', '.aiexclude', '--backup']);
    assert.equal(backupCli.status, 0, backupCli.stderr);
    assert.match(backupCli.stdout, /\(backup: \.aiexclude\.bak/);

    // Exported helper edge cases: 1-arg classifyDirectory & service-account template exclusion
    assert.equal(classifyDirectory('node_modules')?.category, 'dependencies');
    assert.equal(isSensitiveFile('service-account-template.json'), null);

    // 2. install-local: refuse repo root / ancestor / descendant of sourceDir, detect & clean rogue symlink, handle non-dir dest
    assert.throws(() => installSkill({ dest: REPO_ROOT, dryRun: true }), /unsafe destination/i);
    assert.throws(() => uninstallSkill({ dest: REPO_ROOT, dryRun: true }), /unsafe destination/i);
    assert.throws(() => installSkill({ dest: path.join(REPO_ROOT, 'skills'), dryRun: true }), /ancestor|descendant/i);
    assert.throws(() => installSkill({ dest: path.join(REPO_ROOT, 'skills', 'agy-ignore', 'sub'), dryRun: true }), /ancestor|descendant/i);

    const badDestFlag = runNode(INSTALL_SCRIPT, ['--dest', '--check']);
    assert.notEqual(badDestFlag.status, 0);

    const destFile = path.join(tmp, 'file-dest');
    fs.writeFileSync(destFile, 'not-a-dir');
    const fileCheck = checkSkill({ dest: destFile });
    assert.equal(fileCheck.inSync, false);
    assert.match(fileCheck.destError, /not a directory/i);
    assert.throws(() => installSkill({ dest: destFile }), /non-directory|symlink/i);

    const destDir = path.join(tmp, 'skill-dest');
    installSkill({ dest: destDir });
    const outsideDir = path.join(tmp, 'outside-target');
    writeFileDeep(outsideDir, 'keep.txt', 'DO NOT TOUCH\n');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(outsideDir, path.join(destDir, 'rogue-link'), linkType);

    const rogueCheck = checkSkill({ dest: destDir });
    assert.equal(rogueCheck.inSync, false);
    assert.deepEqual(rogueCheck.symlinks, ['rogue-link']);

    const cleaned = installSkill({ dest: destDir });
    assert.ok(cleaned.removed.includes('rogue-link'));
    assert.equal(fs.readFileSync(path.join(outsideDir, 'keep.txt'), 'utf8'), 'DO NOT TOUCH\n');
    assert.equal(checkSkill({ dest: destDir }).inSync, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v1.2.0 detects AI model weights, runtime state dirs, SQLite WAL, DPAPI keys, preventive .gitignore hardening, protects mixed code dirs, and runs isolated --verify', () => {
  const ws = makeTempDir('agy-ignore-v12-');
  try {
    runGit(ws, ['init']);
    // .gitignore ignores .env, /models/, /state/, secrets/ — zero active leaks, but misses .env.*, *.pem, *.key, *.dpapi
    writeFileDeep(ws, '.gitignore', '.env\n/models/\n/state/\nsecrets/\n');
    writeFileDeep(ws, '.env', 'API_KEY=dummy\n');
    writeFileDeep(ws, '.env.example', 'API_KEY=\n');
    writeFileDeep(ws, 'app/main.py', 'print("ok")\n');
    // Mixed data/ dir containing active scripts MUST NOT be classified as noise
    writeFileDeep(ws, 'data/start_all.ps1', 'Write-Host "ok"\n');
    // ORM models/ & frontend state/ containing code MUST NOT be classified as noise
    writeFileDeep(ws, 'src/models/user.py', 'class User: pass\n');
    writeFileDeep(ws, 'src/state/store.ts', 'export const token = "";\n');
    // Real non-code AI weights dir (>= 1 MB) + runtime state dir + Windows DPAPI key
    writeFileDeep(ws, 'models/sense.onnx', Buffer.alloc(1200 * 1024, 0x01));
    writeFileDeep(ws, 'state/brain.sqlite3', Buffer.alloc(4096, 0x02));
    writeFileDeep(ws, 'state/.console_token', 'tok\n');
    writeFileDeep(ws, 'secrets/auth.dpapi', 'dpapi-bytes\n');

    runGit(ws, ['add', '.gitignore', '.env.example', 'app/main.py', 'data/start_all.ps1', 'src/models/user.py', 'src/state/store.ts']);

    const rep = auditWorkspace(ws, { top: 15, maxDepth: 6 });

    // 1. Model weights & runtime state detected; code-bearing dirs protected
    assert.equal(rep.topBySize.find((d) => d.path === 'models')?.category, 'model_media_assets');
    assert.equal(rep.topBySize.find((d) => d.path === 'state')?.category, 'corpus_or_intermediate');
    assert.equal(rep.topBySize.find((d) => d.path === 'state')?.sensitive, true);
    assert.equal(rep.topBySize.find((d) => d.path === 'data')?.category, null);
    assert.equal(classifyDirectory('models', { files: 3, bytes: 5 * 1048576, codeFiles: 1, weightFiles: 2 }), null);
    assert.equal(classifyDirectory('state', { files: 3, bytes: 2048, codeFiles: 2, dbFiles: 1 }), null);

    // 2. Draft anchors /models/ & /state/ (protecting src/models & src/state), plus *.onnx, SQLite WAL/SHM, and dynamic *.dpapi
    const draftLines = rep.recommendations.antigravityIgnoreDraft.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    assert.ok(draftLines.includes('/models/'));
    assert.ok(draftLines.includes('/state/'));
    assert.ok(draftLines.includes('*.onnx'));
    assert.ok(draftLines.includes('*.sqlite3-wal'));
    assert.ok(draftLines.includes('*.sqlite3-shm'));
    assert.ok(draftLines.includes('*.dpapi'));
    assert.ok(rep.recommendations.permissionsDeny.permissions.deny.includes('Read(**/*.dpapi)'));
    assert.ok(rep.recommendations.permissionsDeny.permissions.deny.includes('Read(state/**)'));

    // 3. Zero active leaks, but preventive hardening catches missing .env.* / *.pem / *.key / *.dpapi
    assert.equal(rep.gitLeaks.length, 0);
    assert.equal(rep.recommendations.gitignoreHardening.length, 1);
    const hRules = rep.recommendations.gitignoreHardening[0].rulesToAdd;
    assert.ok(hRules.includes('.env.*') && hRules.includes('!.env.example') && hRules.includes('*.pem') && hRules.includes('*.key') && hRules.includes('*.dpapi'));

    // 4. Isolated --verify PASS on clean .antigravityignore
    writeFileDeep(ws, '.antigravityignore', rep.recommendations.antigravityIgnoreDraft);
    const vPass = verifyIgnoreFile(ws);
    assert.equal(vPass.ok, true);
    assert.deepEqual(vPass.readableTemplates, ['.env.example']);
    assert.deepEqual(vPass.trackedNonLockIgnored, []);
    assert.ok(vPass.ignoredFiles >= 4);
    assert.match(renderVerifyMarkdown(vPass), /Status:\*\* PASS/);

    const cliVerifyPass = runNode(AUDIT_SCRIPT, [ws, '--verify', '--json']);
    assert.equal(cliVerifyPass.status, 0, cliVerifyPass.stderr);
    assert.equal(JSON.parse(cliVerifyPass.stdout).ok, true);

    // 5. Isolated --verify WARN when tracked active script (data/) is accidentally ignored
    fs.appendFileSync(path.join(ws, '.antigravityignore'), '\ndata/\n');
    const vWarn = verifyIgnoreFile(ws);
    assert.equal(vWarn.ok, false);
    assert.ok(vWarn.trackedNonLockIgnored.includes('data/start_all.ps1'));
    const cliVerifyWarn = runNode(AUDIT_SCRIPT, [ws, '--verify']);
    assert.equal(cliVerifyWarn.status, 1);
    assert.match(cliVerifyWarn.stdout, /Status:\*\* WARN/);
    assert.match(cliVerifyWarn.stdout, /data\/start_all\.ps1/);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('v1.2.1 detects .remotion/ & pretrained_models/*_weights* and auto-triages public CA .pem & ML hyperparam config.json', () => {
  const ws = makeTempDir('agy-ignore-v121-');
  try {
    runGit(ws, ['init']);
    writeFileDeep(ws, '.gitignore', 'config.json\n');

    // Public-only CA cert -> NOT flagged; cert+key bundle & private key -> FLAGGED
    writeFileDeep(ws, 'certs/ca.pem', '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n');
    writeFileDeep(ws, 'certs/bundle.pem', '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n');
    writeFileDeep(ws, 'certs/srv.pem', '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----\n');

    // ML hyperparam config (with NLP bos_token_id/pad_token_id) -> NOT flagged
    writeFileDeep(ws, 'pretrained_models/bert/config.json', JSON.stringify({
      architectures: ['BertModel'], hidden_size: 768, bos_token_id: 101, eos_token_id: 102, pad_token_id: 0,
    }));
    writeFileDeep(ws, 'pretrained_models/bert/model.pth', Buffer.alloc(1100 * 1024, 0x01));
    writeFileDeep(ws, 'SoVITS_weights_v5turbo/s2.pth', Buffer.alloc(1100 * 1024, 0x01));
    // ML config with real secret key -> MUST be flagged
    writeFileDeep(ws, 'ml_leak/config.json', JSON.stringify({
      architectures: ['BertModel'], hidden_size: 768, auth: { auth_token: 'secret' },
    }));
    // Regular gitignored app config -> MUST be flagged
    writeFileDeep(ws, 'app/config.json', JSON.stringify({ host: '127.0.0.1', port: 8080 }));
    // Remotion headless browser cache
    writeFileDeep(ws, '.remotion/chrome-headless-shell/chrome.exe', Buffer.alloc(2048, 0x02));

    const rep = auditWorkspace(ws, { top: 15, maxDepth: 6 });
    const sensPaths = new Set(rep.sensitiveItems.map((x) => x.path));
    assert.equal(sensPaths.has('certs/ca.pem'), false);
    assert.equal(sensPaths.has('certs/bundle.pem'), true);
    assert.equal(sensPaths.has('certs/srv.pem'), true);
    assert.equal(sensPaths.has('pretrained_models/bert/config.json'), false);
    assert.equal(sensPaths.has('ml_leak/config.json'), true);
    assert.equal(sensPaths.has('app/config.json'), true);

    const draftLines = rep.recommendations.antigravityIgnoreDraft.split('\n').map((l) => l.trim());
    assert.ok(draftLines.includes('.remotion/'));
    assert.ok(draftLines.includes('/pretrained_models/'));
    assert.ok(draftLines.includes('/SoVITS_weights_v5turbo/'));
    assert.match(fs.readFileSync(path.join(REPO_ROOT, 'skills', 'agy-ignore', 'SKILL.md'), 'utf8'), /禁区助手/);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
