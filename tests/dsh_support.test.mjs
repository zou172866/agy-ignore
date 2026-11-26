import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { auditWorkspace, verifyIgnoreFile } from '../skills/agy-ignore/scripts/audit_workspace.mjs';
import { syncIgnores } from '../skills/agy-ignore/scripts/sync_ignores.mjs';
import { parseCliArgs, applyAntigravityIgnore, renderAgentOutput } from '../bin/agy-ignore.mjs';
import { getDestDirForTarget, resolveTargetDests, parseArgs as parseInstallArgs } from '../scripts/install-local.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI_PATH = path.join(REPO_ROOT, 'bin', 'agy-ignore.mjs');
const INSTALL_SCRIPT = path.join(REPO_ROOT, 'scripts', 'install-local.mjs');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFileDeep(root, relPosix, content) {
  const abs = path.join(root, ...relPosix.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return abs;
}

function runNode(scriptPath, args, env = process.env) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
}

test('auditWorkspace detects existing .dshignore and supports ignoreFile option without breaking default schema', () => {
  const ws = makeTempDir('agy-ignore-dsh-audit-');
  try {
    writeFileDeep(ws, '.dshignore', '# existing dsh rules\ncustom-cache/\n');
    writeFileDeep(ws, 'package.json', '{"name":"dsh-demo"}\n');
    writeFileDeep(ws, 'package-lock.json', '{}\n'.repeat(150));
    writeFileDeep(ws, '.env', 'SECRET=1\n');
    writeFileDeep(ws, '.env.example', 'SECRET=\n');
    writeFileDeep(ws, 'src/index.js', 'export const ok = true;\n');

    const report = auditWorkspace(ws, { ignoreFile: '.dshignore' });
    assert.equal(report.overview.primaryIgnoreFile, '.dshignore');
    assert.ok(
      report.overview.existingIgnoreFiles.some((f) => f.scope === 'root' && f.name === '.dshignore' && f.activeRules === 1),
      'should detect existing root .dshignore'
    );
    assert.match(report.recommendations.antigravityIgnoreDraft, /^# \.dshignore Draft/m);
    assert.match(report.recommendations.antigravityIgnoreDraft, /Existing \.dshignore — MERGE incrementally!/);

    const guardrailsText = renderAgentOutput(report, { target: 'dsh', ignoreFile: '.dshignore' });
    assert.match(guardrailsText, /--target dsh/);
    assert.match(guardrailsText, /DeepSeek Harness note/);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('CLI --target dsh applies, incrementally merges, verifies, and syncs .dshignore cleanly', () => {
  const ws = makeTempDir('agy-ignore-dsh-cli-');
  try {
    writeFileDeep(ws, 'package.json', '{"name":"dsh-cli-demo"}\n');
    writeFileDeep(ws, 'package-lock.json', '{}\n'.repeat(100));
    writeFileDeep(ws, '.env', 'API_KEY=dummy\n');
    writeFileDeep(ws, '.env.example', 'API_KEY=\n');
    writeFileDeep(ws, 'src/app.js', 'console.log(1);\n');

    const parsed = parseCliArgs(['--target', 'dsh', '--apply', ws]);
    assert.equal(parsed.target, 'dsh');
    assert.equal(parsed.ignoreFile, '.dshignore');

    // Explicit --ignore-file overrides target preset
    const overrideParsed = parseCliArgs(['--target', 'dsh', '--ignore-file', '.customignore', ws]);
    assert.equal(overrideParsed.ignoreFile, '.customignore');

    // Create .dshignore
    const rCreate = runNode(CLI_PATH, ['apply', ws, '--target', 'dsh']);
    assert.equal(rCreate.status, 0, rCreate.stderr);
    assert.match(rCreate.stdout, /\.dshignore: created/);
    assert.equal(fs.existsSync(path.join(ws, '.dshignore')), true);
    assert.equal(fs.existsSync(path.join(ws, '.antigravityignore')), false);

    // Idempotent second run
    const rSecond = runNode(CLI_PATH, ['apply', ws, '--target', 'dsh']);
    assert.equal(rSecond.status, 0, rSecond.stderr);
    assert.match(rSecond.stdout, /\.dshignore: unchanged \(\+0 rules, \+0 toggles\)/);

    // Incremental merge preserves existing user .dshignore rules & CRLF
    fs.writeFileSync(path.join(ws, '.dshignore'), '# user dsh header\r\nmy-dsh-tmp/\r\n', 'utf8');
    const report = auditWorkspace(ws, { ignoreFile: '.dshignore' });
    const merged = applyAntigravityIgnore(ws, report, { ignoreFile: '.dshignore' });
    assert.equal(merged.action, 'merged');
    const mergedBody = fs.readFileSync(path.join(ws, '.dshignore'), 'utf8');
    assert.ok(mergedBody.startsWith('# user dsh header\r\nmy-dsh-tmp/\r\n'));
    assert.match(mergedBody, /package-lock\.json/);

    // Verify .dshignore passes with .env blocked & .env.example readable
    const vRes = verifyIgnoreFile(ws, { ignoreFile: '.dshignore' });
    assert.equal(vRes.ok, true);
    assert.equal(vRes.ignoreFile, '.dshignore');
    const rVerify = runNode(CLI_PATH, ['verify', ws, '--target', 'dsh']);
    assert.equal(rVerify.status, 0, rVerify.stderr);
    assert.match(rVerify.stdout, /# Ignore Verification Report \(`\.dshignore`\)/);

    // Sync .dshignore -> .antigravityignore
    const sRes = syncIgnores(ws, { source: '.dshignore', targets: ['.antigravityignore'], backup: true });
    assert.equal(sRes.results[0].action, 'created');
    assert.match(fs.readFileSync(path.join(ws, '.antigravityignore'), 'utf8'), /Source: \.dshignore/);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('install-local.mjs supports --target dsh, agents, and multi-target install/check/uninstall with DSH_HOME override', () => {
  const fakeHome = makeTempDir('agy-ignore-dsh-home-');
  const customDshHome = path.join(fakeHome, 'custom-dsh');
  try {
    assert.equal(
      getDestDirForTarget('dsh', fakeHome, { DSH_HOME: customDshHome }),
      path.join(customDshHome, 'skills', 'agy-ignore')
    );
    assert.equal(
      getDestDirForTarget('agents', fakeHome, {}),
      path.join(fakeHome, '.agents', 'skills', 'agy-ignore')
    );
    const allTargets = resolveTargetDests('all', fakeHome, {});
    assert.deepEqual(allTargets.map((t) => t.target), ['antigravity', 'dsh', 'agents']);

    const parsed = parseInstallArgs(['--target', 'dsh,agents'], fakeHome, { DSH_HOME: customDshHome });
    assert.equal(parsed.targets.length, 2);

    const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, DSH_HOME: customDshHome };

    // Install to dsh & agents
    const rInst = runNode(INSTALL_SCRIPT, ['--target', 'dsh,agents', '--json'], env);
    assert.equal(rInst.status, 0, rInst.stderr);
    const instJson = JSON.parse(rInst.stdout);
    assert.equal(instJson.results.length, 2);
    assert.equal(fs.existsSync(path.join(customDshHome, 'skills', 'agy-ignore', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(fakeHome, '.agents', 'skills', 'agy-ignore', 'SKILL.md')), true);

    // Check zero drift
    const rCheck = runNode(INSTALL_SCRIPT, ['--target', 'dsh,agents', '--check'], env);
    assert.equal(rCheck.status, 0, rCheck.stderr);

    // Uninstall dsh only; agents remains intact
    const rUninst = runNode(INSTALL_SCRIPT, ['--target', 'dsh', '--uninstall'], env);
    assert.equal(rUninst.status, 0, rUninst.stderr);
    assert.equal(fs.existsSync(path.join(customDshHome, 'skills', 'agy-ignore')), false);
    assert.equal(fs.existsSync(path.join(fakeHome, '.agents', 'skills', 'agy-ignore', 'SKILL.md')), true);
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});
