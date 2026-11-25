import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseCliArgs,
  mergeAntigravityIgnore,
  applyAntigravityIgnore,
  applyGitignorePatches,
} from '../bin/agy-ignore.mjs';
import { auditWorkspace } from '../skills/agy-ignore/scripts/audit_workspace.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI_PATH = path.join(REPO_ROOT, 'bin', 'agy-ignore.mjs');
const BAT_PATH = path.join(REPO_ROOT, 'windows', 'agy-ignore.bat');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFileDeep(root, relPosix, content) {
  const abs = path.join(root, ...relPosix.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return abs;
}

function runGit(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function runCliProc(args, cwd = REPO_ROOT) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { cwd, encoding: 'utf8', windowsHide: true });
}

test('agy-ignore CLI defaults to read-only audit + Agent Guardrails in non-TTY and supports --json/--help/--version', () => {
  const ws = makeTempDir('agy-ignore-cli-ro-');
  try {
    writeFileDeep(ws, 'package.json', '{"name":"demo"}\n');
    writeFileDeep(ws, 'package-lock.json', '{}\n'.repeat(200));
    writeFileDeep(ws, '.edge-profile/Cache/data.bin', 'x'.repeat(2048));
    writeFileDeep(ws, 'src/index.js', 'export const ok = true;\n');

    const rHelp = runCliProc(['--help']);
    assert.equal(rHelp.status, 0);
    assert.match(rHelp.stdout, /agy-ignore v/);

    const rVer = runCliProc(['--version']);
    assert.equal(rVer.status, 0);
    assert.match(rVer.stdout.trim(), /^\d+\.\d+\.\d+/);

    // Non-TTY bare call must be read-only and include Agent Guardrails footer
    const rBare = runCliProc([ws]);
    assert.equal(rBare.status, 0, rBare.stderr);
    assert.match(rBare.stdout, /# Workspace Context & Ignore Audit Report/);
    assert.match(rBare.stdout, /## Agent Guardrails/);
    assert.equal(fs.existsSync(path.join(ws, '.antigravityignore')), false, 'non-TTY default must not write files');

    // --json without mutation flags must return full audit JSON (not mutation summary)
    const rJson = runCliProc([ws, '--json']);
    assert.equal(rJson.status, 0, rJson.stderr);
    const parsed = JSON.parse(rJson.stdout);
    assert.ok(parsed.overview && parsed.recommendations && parsed.savings);
    assert.equal(fs.existsSync(path.join(ws, '.antigravityignore')), false);

    // Reject unknown flags & missing flag values
    assert.notEqual(runCliProc(['--bogus']).status, 0);
    assert.notEqual(runCliProc(['--top']).status, 0);
    assert.throws(() => parseCliArgs(['--format', 'yaml']));
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('agy-ignore --apply creates, incrementally merges while preserving user rules, stays idempotent, and supports --dry-run & --sync', () => {
  const ws = makeTempDir('agy-ignore-cli-apply-');
  try {
    writeFileDeep(ws, 'package.json', '{"name":"demo"}\n');
    writeFileDeep(ws, 'package-lock.json', '{}\n'.repeat(100));
    writeFileDeep(ws, 'txt/03-chunks/c001.txt', 'chunk');
    for (let i = 1; i <= 6; i++) writeFileDeep(ws, `txt/04-cleaned/00${i}.md`, `# cleaned ${i}\n`);
    writeFileDeep(ws, 'src/app.js', 'console.log(1);\n');

    // Dry-run sync before .antigravityignore exists must not throw or create files
    const rDrySync = runCliProc([ws, '--sync', '--dry-run', '--json']);
    assert.equal(rDrySync.status, 0, rDrySync.stderr);
    const dryJson = JSON.parse(rDrySync.stdout);
    assert.equal(dryJson.antigravityignore.action, 'would_created');
    assert.equal(dryJson.sync.results[0].action, 'would_create_after_apply');
    assert.equal(fs.existsSync(path.join(ws, '.antigravityignore')), false);
    assert.equal(fs.existsSync(path.join(ws, '.geminiignore')), false);

    // First --apply creates .antigravityignore
    const rCreate = runCliProc(['apply', ws]);
    assert.equal(rCreate.status, 0, rCreate.stderr);
    assert.match(rCreate.stdout, /\.antigravityignore: created/);
    const createdText = fs.readFileSync(path.join(ws, '.antigravityignore'), 'utf8');
    assert.match(createdText, /txt\/03-chunks\//);
    assert.match(createdText, /# txt\/04-cleaned\//);
    assert.doesNotMatch(createdText, /^# NOTE: Existing/m);

    // Second --apply is 100% idempotent
    const rSecond = runCliProc([ws, '--apply']);
    assert.equal(rSecond.status, 0, rSecond.stderr);
    assert.match(rSecond.stdout, /\.antigravityignore: unchanged \(\+0 rules, \+0 toggles\)/);

    // Custom user file: incremental merge preserves every user comment & rule, adds only missing rules
    const customExisting = [
      '# My custom header comment',
      'my-custom-secret-dir/',
      'node_modules/',
      '',
    ].join('\r\n');
    fs.writeFileSync(path.join(ws, '.antigravityignore'), customExisting, 'utf8');

    const report = auditWorkspace(ws);
    const mergedRes = applyAntigravityIgnore(ws, report);
    assert.equal(mergedRes.action, 'merged');
    assert.ok(mergedRes.addedRules.includes('txt/03-chunks/'));
    assert.ok(!mergedRes.addedRules.includes('node_modules/'));

    const mergedText = fs.readFileSync(path.join(ws, '.antigravityignore'), 'utf8');
    assert.ok(mergedText.startsWith('# My custom header comment\r\nmy-custom-secret-dir/\r\nnode_modules/\r\n'));
    assert.match(mergedText, /# --- Added by agy-ignore ---/);
    assert.match(mergedText, /txt\/03-chunks\//);

    // Re-running merge is now unchanged
    const thirdRes = applyAntigravityIgnore(ws, report);
    assert.equal(thirdRes.action, 'unchanged');

    // --sync writes .geminiignore and .aiexclude (and backs up pre-existing conflicting file)
    writeFileDeep(ws, '.geminiignore', '# pre-existing user geminiignore\ncustom/\n');
    const rSync = runCliProc(['sync', ws]);
    assert.equal(rSync.status, 0, rSync.stderr);
    assert.match(rSync.stdout, /\.geminiignore: backed_up_and_updated/);
    assert.match(rSync.stdout, /\.aiexclude: created/);
    assert.equal(fs.existsSync(path.join(ws, '.geminiignore.bak')), true);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('agy-ignore --fix-gitignore patches unignored leaks safely without auto-untracking tracked files', () => {
  const ws = makeTempDir('agy-ignore-cli-git-');
  try {
    runGit(ws, ['init']);
    runGit(ws, ['config', 'user.email', 'test@example.com']);
    runGit(ws, ['config', 'user.name', 'Test']);
    writeFileDeep(ws, '.gitignore', 'node_modules/\n');
    writeFileDeep(ws, '.edge-profile/Cookies', 'cookie-bytes');
    writeFileDeep(ws, '.env', 'API_KEY=secret\n');
    writeFileDeep(ws, 'src/index.js', 'export default 1;\n');
    runGit(ws, ['add', '.gitignore', 'src/index.js', '.env']);
    runGit(ws, ['commit', '-m', 'init']);

    const before = auditWorkspace(ws);
    assert.ok(before.gitLeaks.some((l) => l.path === '.edge-profile' && !l.ignoredByGitignore));

    // Dry-run leaves .gitignore untouched
    const dryRes = applyGitignorePatches(ws, before.recommendations.gitignorePatches, { dryRun: true });
    assert.equal(dryRes[0].action, 'would_update');
    assert.equal(fs.readFileSync(path.join(ws, '.gitignore'), 'utf8'), 'node_modules/\n');

    // Apply via CLI
    const rFix = runCliProc([ws, '--fix-gitignore']);
    assert.equal(rFix.status, 0, rFix.stderr);
    assert.match(rFix.stdout, /\[\.\] \.gitignore: updated/);
    assert.match(rFix.stdout, /untrack \(manual\): git rm --cached/);

    // .edge-profile is now ignored by git, while tracked .env remains tracked (not silently untracked)
    const checkIgn = spawnSync('git', ['check-ignore', '.edge-profile/'], { cwd: ws, encoding: 'utf8' });
    assert.equal(checkIgn.status, 0);
    const trackedEnv = runGit(ws, ['ls-files', '.env']).trim();
    assert.equal(trackedEnv, '.env', 'must never auto-untrack committed files');

    // Re-running is unchanged
    const rFixAgain = runCliProc([ws, '--fix-gitignore']);
    assert.equal(rFixAgain.status, 0);
    assert.match(rFixAgain.stdout, /no patches needed|unchanged/);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('mergeAntigravityIgnore handles edge cases and windows/agy-ignore.bat works on CJK + spaces + parentheses paths', () => {
  const r = mergeAntigravityIgnore('dist/\n/node_modules/\n', '# .antigravityignore Draft\n\n# 2. Deps\nnode_modules/\ndist/\n*.log\n');
  assert.equal(r.action, 'merged');
  assert.deepEqual(r.addedRules, ['*.log']);

  if (process.platform === 'win32') {
    const base = makeTempDir('agy-ignore-bat-');
    const cjkDir = path.join(base, '测试 项目 (v1)');
    try {
      writeFileDeep(cjkDir, 'package.json', '{"name":"cjk-demo"}\n');
      writeFileDeep(cjkDir, 'src/main.js', 'console.log("ok");\n');
      const rBat = spawnSync('cmd.exe', ['/d', '/c', BAT_PATH, `${cjkDir}\\`, '--check', '--no-pause'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      assert.equal(rBat.status, 0, `bat failed: ${rBat.stderr || rBat.stdout}`);
      assert.match(rBat.stdout, /# Workspace Context & Ignore Audit Report/);
      assert.match(rBat.stdout, /## Agent Guardrails/);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  }
});
