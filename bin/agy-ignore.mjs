#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { auditWorkspace, renderMarkdown } from '../skills/agy-ignore/scripts/audit_workspace.mjs';
import { syncIgnores } from '../skills/agy-ignore/scripts/sync_ignores.mjs';

const PKG_PATH = new URL('../package.json', import.meta.url);
const VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')).version || '1.0.0'; } catch { return '1.0.0'; }
})();

const low = (s) => s.toLowerCase();
const normKey = (s) => (process.platform === 'win32' ? low(s) : s);

function readVal(argv, i, flag) {
  const v = argv[i + 1];
  if (v === undefined || v === '' || v.startsWith('-')) throw new Error(`Missing value for ${flag}`);
  return v;
}

function parsePosInt(raw, flag, min, max) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid value for ${flag}: ${raw}`);
  return n;
}

export function getHelpText() {
  return [
    `agy-ignore v${VERSION} — Audit-first three-layer ignore & context noise tool (0 prompt tokens)`,
    '',
    'Usage:',
    '  agy-ignore [dir] [options]',
    '  agy-ignore check [dir]        Read-only audit report (default in non-TTY / LLM)',
    '  agy-ignore apply [dir]        Create or incrementally merge .antigravityignore',
    '  agy-ignore sync  [dir]        Apply .antigravityignore and sync .geminiignore,.aiexclude',
    '',
    'Options:',
    '  --check                       Read-only audit report + Agent Guardrails (no file edits)',
    '  --apply                       Create or incrementally merge .antigravityignore',
    '  --sync                        Also sync .antigravityignore -> .geminiignore,.aiexclude',
    '  --targets <list>              Comma-separated sync targets (default: .geminiignore,.aiexclude)',
    '  --fix-gitignore               Append missing high-risk leak rules to repo .gitignore files',
    '  --dry-run                     Preview file changes without writing to disk',
    '  --force                       Overwrite sync conflicts instead of backing up',
    '  --format <md|json>            Audit report output format (default: md)',
    '  --json                        Output structured JSON',
    '  --top <N>                     Top N directories in audit report (default: 12)',
    '  --max-depth <N>               Max traversal depth (default: 6)',
    '  --interactive                 Force interactive menu mode',
    '  --pause / --no-pause          Wait for Enter before exiting (useful for .bat shortcuts)',
    '  -v, --version                 Show version',
    '  -h, --help                    Show this help message',
  ].join('\n');
}

export function parseCliArgs(argv = []) {
  const opts = {
    targetDir: '.',
    check: false,
    apply: false,
    sync: false,
    fixGitignore: false,
    dryRun: false,
    force: false,
    backup: true,
    targets: ['.geminiignore', '.aiexclude'],
    format: 'md',
    json: false,
    top: 12,
    maxDepth: 6,
    interactive: false,
    pause: false,
    noPause: false,
    help: false,
    version: false,
  };
  let subDone = false;
  let dirDone = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '-v' || a === '--version') opts.version = true;
    else if (a === '--check') opts.check = true;
    else if (a === '--apply') opts.apply = true;
    else if (a === '--sync') opts.sync = true;
    else if (a === '--fix-gitignore') opts.fixGitignore = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--force') { opts.force = true; opts.backup = false; }
    else if (a === '--backup') opts.backup = true;
    else if (a === '--json') { opts.json = true; opts.format = 'json'; }
    else if (a === '--interactive') opts.interactive = true;
    else if (a === '--pause') opts.pause = true;
    else if (a === '--no-pause') opts.noPause = true;
    else if (a === '--format') {
      const v = low(readVal(argv, i++, '--format'));
      if (v !== 'md' && v !== 'json') throw new Error(`Invalid --format: ${v}`);
      opts.format = v;
      if (v === 'json') opts.json = true;
    } else if (a === '--targets') {
      const list = readVal(argv, i++, '--targets').split(',').map((s) => s.trim()).filter(Boolean);
      if (!list.length) throw new Error('Empty --targets list');
      opts.targets = list;
    } else if (a === '--top') opts.top = parsePosInt(readVal(argv, i++, '--top'), '--top', 1, 100);
    else if (a === '--max-depth') opts.maxDepth = parsePosInt(readVal(argv, i++, '--max-depth'), '--max-depth', 1, 32);
    else if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
    else if (!subDone && !dirDone && (a === 'check' || a === 'audit' || a === 'apply' || a === 'sync')) {
      subDone = true;
      if (a === 'check' || a === 'audit') opts.check = true;
      else if (a === 'apply') opts.apply = true;
      else if (a === 'sync') { opts.apply = true; opts.sync = true; }
    } else if (!dirDone) {
      opts.targetDir = a;
      dirDone = true;
    } else {
      throw new Error(`Unexpected argument: ${a}`);
    }
  }
  if (opts.noPause) opts.pause = false;
  return opts;
}

function lstatOrNull(p) {
  try { return fs.lstatSync(p); } catch (e) { if (e && e.code === 'ENOENT') return null; throw e; }
}

function assertSafePathInside(root, targetAbs) {
  const rel = path.relative(root, targetAbs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Refusing path outside workspace: ${targetAbs}`);
  }
  const parts = rel.split(path.sep);
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = path.join(cur, parts[i]);
    const st = lstatOrNull(cur);
    if (!st) break;
    if (st.isSymbolicLink() || !st.isDirectory()) {
      throw new Error(`Refusing symlink/non-directory parent: ${cur}`);
    }
  }
  const leaf = lstatOrNull(targetAbs);
  if (leaf && (leaf.isSymbolicLink() || leaf.isDirectory())) {
    throw new Error(`Refusing symlink or directory target: ${targetAbs}`);
  }
  return leaf;
}

function canonicalRule(line) {
  const t = line.trim();
  if (!t || t.startsWith('#')) return null;
  const neg = t.startsWith('!') ? '!' : '';
  const body = (neg ? t.slice(1) : t).replace(/^\/+/, '');
  return normKey(`${neg}${body}`);
}

function canonicalToggle(line) {
  const m = line.match(/^\s*#\s*(\S.+?)\s*$/);
  if (!m) return null;
  const candidate = m[1].trim();
  // Skip headings, notes, and placeholders
  if (/^(\d+\.|---|===|NOTE:|\(None\)|\.antigravityignore|Added by agy-ignore|Optional toggles)/i.test(candidate)) return null;
  if (/\s{2,}|—|--/.test(candidate)) return null;
  return canonicalRule(candidate);
}

export function mergeAntigravityIgnore(existingContent, draftContent) {
  const draftLines = draftContent.replace(/\r\n/g, '\n').split('\n');
  const cleanedDraft = draftLines
    .filter((l) => !/^#\s*NOTE:\s*Existing\s+\.antigravityignore/i.test(l.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd() + '\n';

  if (existingContent == null) {
    const addedRules = draftLines.map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const addedToggles = [];
    let inToggles = false;
    for (const raw of draftLines) {
      const t = raw.trim();
      if (/^#\s*5\.\s*Optional toggles/i.test(t)) { inToggles = true; continue; }
      if (inToggles && t.startsWith('#') && !/^#\s*\(None\)/i.test(t)) addedToggles.push(t);
    }
    return { action: 'created', addedRules, addedToggles, content: cleanedDraft };
  }

  const eol = existingContent.includes('\r\n') ? '\r\n' : '\n';
  const existingLines = existingContent.replace(/\r\n/g, '\n').split('\n');
  const existingActive = new Set();
  const existingCommented = new Set();

  for (const line of existingLines) {
    const r = canonicalRule(line);
    if (r) existingActive.add(r);
    else {
      const tg = canonicalToggle(line);
      if (tg) existingCommented.add(tg);
    }
  }

  const addedRules = [];
  const addedToggles = [];
  const seenNewRules = new Set();
  const seenNewToggles = new Set();
  let inToggles = false;

  for (const raw of draftLines) {
    const t = raw.trim();
    if (/^#\s*5\.\s*Optional toggles/i.test(t)) { inToggles = true; continue; }
    if (!inToggles) {
      const key = canonicalRule(t);
      if (key && !existingActive.has(key) && !seenNewRules.has(key)) {
        seenNewRules.add(key);
        addedRules.push(t);
      }
    } else if (t.startsWith('#') && !/^#\s*\(None\)/i.test(t)) {
      const key = canonicalToggle(t);
      if (key && !existingActive.has(key) && !existingCommented.has(key) && !seenNewToggles.has(key)) {
        seenNewToggles.add(key);
        addedToggles.push(t);
      }
    }
  }

  if (!addedRules.length && !addedToggles.length) {
    return { action: 'unchanged', addedRules: [], addedToggles: [], content: existingContent };
  }

  const block = [
    '# --- Added by agy-ignore ---',
    ...addedRules,
    ...(addedToggles.length ? ['# Optional toggles (uncomment when not actively working on these outputs)', ...addedToggles] : []),
  ].join(eol);

  const trimmedExisting = existingContent.replace(/(\r?\n)*$/, '');
  const prefix = trimmedExisting.length ? `${trimmedExisting}${eol}${eol}` : '';
  return {
    action: 'merged',
    addedRules,
    addedToggles,
    content: `${prefix}${block}${eol}`,
  };
}

export function applyAntigravityIgnore(workspaceRoot, report, { dryRun = false } = {}) {
  const root = path.resolve(workspaceRoot);
  const targetPath = path.join(root, '.antigravityignore');
  const st = assertSafePathInside(root, targetPath);
  const existing = st ? fs.readFileSync(targetPath, 'utf8') : null;
  const merged = mergeAntigravityIgnore(existing, report.recommendations.antigravityIgnoreDraft);

  if (!dryRun && merged.action !== 'unchanged') {
    fs.writeFileSync(targetPath, merged.content, 'utf8');
  }

  const action = dryRun && merged.action !== 'unchanged' ? `would_${merged.action}` : merged.action;
  return {
    targetPath,
    action,
    addedRules: merged.addedRules,
    addedToggles: merged.addedToggles,
    dryRun,
  };
}

export function applyGitignorePatches(workspaceRoot, patches, { dryRun = false } = {}) {
  const root = path.resolve(workspaceRoot);
  const results = [];

  for (const patch of patches || []) {
    const repoDir = patch.repo === '.' ? root : path.join(root, ...patch.repo.split('/'));
    const gitignorePath = path.join(repoDir, '.gitignore');
    const st = assertSafePathInside(root, gitignorePath);
    const existing = st ? fs.readFileSync(gitignorePath, 'utf8') : null;
    const eol = existing && existing.includes('\r\n') ? '\r\n' : '\n';
    const existingSet = new Set(
      (existing ? existing.replace(/\r\n/g, '\n').split('\n') : []).map(canonicalRule).filter(Boolean)
    );
    const toAdd = [];
    for (const rule of patch.rulesToAdd || []) {
      const k = canonicalRule(rule);
      if (k && !existingSet.has(k)) {
        existingSet.add(k);
        toAdd.push(rule.trim());
      }
    }

    let action = 'unchanged';
    if (toAdd.length) {
      const base = existing ? existing.replace(/(\r?\n)*$/, '') : '';
      const block = ['# Added by agy-ignore', ...toAdd].join(eol);
      const next = base ? `${base}${eol}${eol}${block}${eol}` : `${block}${eol}`;
      action = existing ? (dryRun ? 'would_update' : 'updated') : (dryRun ? 'would_create' : 'created');
      if (!dryRun) fs.writeFileSync(gitignorePath, next, 'utf8');
    }

    results.push({
      repo: patch.repo,
      gitignorePath,
      action,
      addedRules: toAdd,
      untrackCommands: patch.untrackCommands || [],
    });
  }
  return results;
}

export function copyToClipboard(text) {
  const cmd = process.platform === 'win32'
    ? ['clip', []]
    : process.platform === 'darwin'
      ? ['pbcopy', []]
      : ['xclip', ['-selection', 'clipboard']];
  const r = spawnSync(cmd[0], cmd[1], { input: text, encoding: 'utf8', windowsHide: true });
  return !r.error && r.status === 0;
}

export function renderAgentOutput(report) {
  const guardrails = [
    '',
    '## Agent Guardrails',
    '- Apply or incrementally merge `.antigravityignore` via `agy-ignore "<dir>" --apply` (preserves user rules; never emits global `*.png`, `*.svg`, `*.json`, `*.md`, `bin/`, or `env/`).',
    '- Keep active code/deliverables readable; place borderline folders (`04-cleaned/`, datasets) under `# ` optional toggles.',
    '- Confirm with the user before running `--fix-gitignore` or `git rm --cached` on tracked files.',
    '- Never auto-edit `~/.gemini/config/config.json`; present `permissions.deny` for manual setup in **Settings → Security / Permissions (Strict Mode)**.',
    '- Only pass `--sync` (`.geminiignore`, `.aiexclude`) when the user requests multi-tool compatibility.',
    '',
  ].join('\n');
  return `${renderMarkdown(report).trimEnd()}\n${guardrails}`;
}

function printInteractiveSummary(report, preview) {
  const { overview: o, topBySize, sensitiveItems, gitLeaks, savings: sv } = report;
  const line = '─'.repeat(62);
  console.log(`\n${line}`);
  console.log(`  agy-ignore v${VERSION} — 工作区三层防噪体检`);
  console.log(line);
  console.log(`  目标目录：${o.root}`);
  console.log(`  文件总计：${o.totalFiles.toLocaleString('en-US')} 个 (${o.totalMB.toFixed(2)} MB)`);
  console.log(`  技术栈  ：${o.detectedStacks.join(', ') || '通用目录'}`);
  console.log(`  预计减负：过滤 ${sv.estimatedFilteredFiles.toLocaleString('en-US')} 文件 (${sv.fileReductionPct}%) / ${sv.estimatedFilteredMB.toFixed(2)} MB (${sv.sizeReductionPct}%)`);
  console.log(`  剩余活跃：${sv.remainingFiles.toLocaleString('en-US')} 文件 (${sv.remainingMB.toFixed(2)} MB)`);

  const top = topBySize.slice(0, 5);
  if (top.length) {
    console.log('\n  [体积 Top 目录]');
    for (const d of top) {
      const tag = d.category ? ` [${d.category}${d.borderline ? '·灰区' : ''}]` : '';
      console.log(`   - ${d.path}/  (${d.sizeMB.toFixed(2)} MB, ${d.files} 文件)${tag}`);
    }
  }

  console.log(`\n  [.antigravityignore 状态]`);
  if (preview.action === 'would_created') {
    console.log(`   - 将新建 .antigravityignore（含 ${preview.addedRules.length} 条规则，${preview.addedToggles.length} 条可选开关）`);
  } else if (preview.action === 'would_merged') {
    console.log(`   - 检测到已有文件：将无损增量追加 ${preview.addedRules.length} 条规则 / ${preview.addedToggles.length} 条可选开关`);
  } else {
    console.log('   - 已有 .antigravityignore 已覆盖全部建议项（无需新增）');
  }

  if (sensitiveItems.length) {
    console.log(`\n  [敏感路径提醒] 共 ${sensitiveItems.length} 处（建议配 Layer 1 permissions.deny 硬拦截）`);
    for (const s of sensitiveItems.slice(0, 5)) {
      console.log(`   - ${s.isDir ? `${s.path}/` : s.path} (${s.category})`);
    }
  }

  if (gitLeaks.length) {
    console.log(`\n  [.gitignore 漏配警告] 发现 ${gitLeaks.length} 处高风险项！`);
    for (const l of gitLeaks.slice(0, 5)) {
      const trk = l.isTracked ? `，已追踪(${l.trackedFileCount})` : '';
      console.log(`   - [${l.repo}] ${l.isDir ? `${l.path}/` : l.path} (${l.action}${trk})`);
    }
  } else {
    console.log('\n  [.gitignore 巡检] 0 高风险漏配');
  }
  console.log(line);
}

async function runInteractive(report, opts) {
  const root = report.overview.root;
  let currentReport = report;
  let preview = applyAntigravityIgnore(root, currentReport, { dryRun: true });
  printInteractiveSummary(currentReport, preview);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const hasGitPatches = currentReport.recommendations.gitignorePatches.some((p) => p.rulesToAdd.length > 0);
      console.log('\n请选择操作（直接回车默认执行 [1]）：');
      console.log('  [1] 生成 / 增量更新 .antigravityignore（推荐）');
      console.log('  [2] 更新 .antigravityignore 并同步 .geminiignore + .aiexclude');
      if (hasGitPatches) console.log('  [3] 顺手补齐检出的 .gitignore 漏配');
      console.log('  [4] 复制 permissions.deny 安全 JSON 到剪贴板');
      console.log('  [0] 退出');

      const ans = (await rl.question('\n输入编号 [1]: ')).trim() || '1';
      if (ans === '0' || low(ans) === 'q') break;

      if (ans === '1' || ans === '2') {
        const res = applyAntigravityIgnore(root, currentReport, { dryRun: opts.dryRun });
        console.log(`\n✔ .antigravityignore -> ${res.action}（新增规则 ${res.addedRules.length} 条，可选开关 ${res.addedToggles.length} 条）`);
        if (ans === '2') {
          const syncRes = syncIgnores(root, { targets: opts.targets, backup: opts.backup, force: opts.force, dryRun: opts.dryRun });
          for (const item of syncRes.results) {
            console.log(`✔ ${item.target} -> ${item.action}${item.backupPath ? ` (备份: ${path.basename(item.backupPath)})` : ''}`);
          }
        }
        break;
      } else if (ans === '3' && hasGitPatches) {
        const gRes = applyGitignorePatches(root, currentReport.recommendations.gitignorePatches, { dryRun: opts.dryRun });
        for (const g of gRes) {
          console.log(`✔ [${g.repo}] .gitignore -> ${g.action}（新增 ${g.addedRules.length} 条）`);
          if (g.untrackCommands.length) {
            console.log('  ⚠ 以下文件已被 Git 追踪，如需取消追踪请手动确认执行：');
            for (const cmd of g.untrackCommands) console.log(`    ${cmd}`);
          }
        }
        currentReport = auditWorkspace(root, { top: opts.top, maxDepth: opts.maxDepth });
      } else if (ans === '4') {
        const snippet = JSON.stringify(currentReport.recommendations.permissionsDeny, null, 2);
        if (copyToClipboard(snippet)) {
          console.log('\n✔ 已复制 permissions.deny JSON 到剪贴板，请手动贴入 Antigravity Settings → Permissions。');
        } else {
          console.log('\n无法访问系统剪贴板，请手动复制以下片段：\n' + snippet);
        }
      } else {
        console.log('无效选项，请输入菜单中的编号。');
      }
    }
  } finally {
    rl.close();
  }
}

async function pauseIfNeeded(shouldPause) {
  if (!shouldPause || !process.stdin.isTTY) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { await rl.question('\n按回车键关闭窗口...'); } finally { rl.close(); }
}

export async function runCli(argv = process.argv.slice(2)) {
  const opts = parseCliArgs(argv);
  if (opts.help) { console.log(getHelpText()); return 0; }
  if (opts.version) { console.log(VERSION); return 0; }

  const report = auditWorkspace(opts.targetDir, { top: opts.top, maxDepth: opts.maxDepth });
  const root = report.overview.root;
  const hasMutation = opts.apply || opts.sync || opts.fixGitignore;
  const hasExplicitAction = opts.check || hasMutation || opts.json;

  // Interactive mode: explicit --interactive, OR real TTY with no explicit flags
  if (opts.interactive || (!hasExplicitAction && process.stdin.isTTY && process.stdout.isTTY)) {
    await runInteractive(report, opts);
    await pauseIfNeeded(opts.pause);
    return 0;
  }

  // Non-TTY default, --check, or --json without mutation flags: read-only audit + Agent Guardrails (0 prompt tokens!)
  if (opts.check || !hasMutation) {
    console.log(opts.format === 'json' ? JSON.stringify(report, null, 2) : renderAgentOutput(report));
    await pauseIfNeeded(opts.pause);
    return 0;
  }

  // Deterministic mutation flags (--apply / --sync / --fix-gitignore)
  const summary = { root, dryRun: opts.dryRun, antigravityignore: null, sync: null, gitignore: null };
  if (opts.apply || opts.sync) {
    summary.antigravityignore = applyAntigravityIgnore(root, report, { dryRun: opts.dryRun });
  }
  if (opts.sync) {
    const srcPath = path.join(root, '.antigravityignore');
    if (opts.dryRun && !fs.existsSync(srcPath)) {
      summary.sync = {
        workspaceRoot: root,
        sourcePath: srcPath,
        dryRun: true,
        hasConflicts: false,
        results: opts.targets.map((target) => ({
          target,
          action: 'would_create_after_apply',
          changed: false,
          backupPath: null,
          message: null,
        })),
      };
    } else {
      summary.sync = syncIgnores(root, { targets: opts.targets, backup: opts.backup, force: opts.force, dryRun: opts.dryRun });
    }
  }
  if (opts.fixGitignore) {
    summary.gitignore = applyGitignorePatches(root, report.recommendations.gitignorePatches, { dryRun: opts.dryRun });
  }

  if (opts.json) {
    console.log(JSON.stringify({ ...summary, savings: report.savings, gitLeaks: report.gitLeaks, permissionsDeny: report.recommendations.permissionsDeny }, null, 2));
  } else {
    if (summary.antigravityignore) {
      const a = summary.antigravityignore;
      console.log(`.antigravityignore: ${a.action} (+${a.addedRules.length} rules, +${a.addedToggles.length} toggles)`);
    }
    if (summary.sync) {
      for (const r of summary.sync.results) {
        console.log(`${r.target}: ${r.action}${r.backupPath ? ` (backup: ${path.basename(r.backupPath)})` : ''}`);
      }
    }
    if (summary.gitignore) {
      if (!summary.gitignore.length) console.log('.gitignore: no patches needed');
      for (const g of summary.gitignore) {
        console.log(`[${g.repo}] .gitignore: ${g.action} (+${g.addedRules.length} rules)`);
        for (const cmd of g.untrackCommands) console.log(`  untrack (manual): ${cmd}`);
      }
    }
    const sv = report.savings;
    console.log(`Estimated savings: ${sv.estimatedFilteredFiles}/${report.overview.totalFiles} files (${sv.fileReductionPct}%), ${sv.estimatedFilteredMB.toFixed(2)}/${report.overview.totalMB.toFixed(2)} MB (${sv.sizeReductionPct}%)`);
  }

  if (summary.sync && summary.sync.hasConflicts && !opts.dryRun) return 1;
  await pauseIfNeeded(opts.pause);
  return 0;
}

function realUrl(p) {
  try { p = fs.realpathSync(p); } catch {}
  const href = pathToFileURL(path.resolve(p)).href;
  return process.platform === 'win32' ? low(href) : href;
}

if (process.argv[1] && realUrl(fileURLToPath(import.meta.url)) === realUrl(process.argv[1])) {
  runCli(process.argv.slice(2))
    .then((code) => { if (code) process.exitCode = code; })
    .catch((err) => {
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
    });
}
