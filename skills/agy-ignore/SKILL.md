---
name: agy-ignore
description: Audit-first workspace bloat & three-layer ignore rules for Antigravity (.antigravityignore), .gitignore leak audit, permissions.deny, and .geminiignore/.aiexclude sync (忽略规则 / 上下文防噪 / 敏感文件排查).
---

# agy-ignore — Three-Layer Ignore SOP

Generate tailored ignore rules from measured metrics, never static templates. Read [guardrails.md](./references/guardrails.md) on demand for Layer 1 Strict Mode, `.aiexclude` negation caveats, or anti-patterns.

## Invariants

1. **Audit first (read-only).** Run the audit script before editing any ignore file.
2. **Noise vs. deliverables.** Keep active code/outputs readable; put borderline dirs (`04-cleaned/`, datasets) in `# ` toggles.
3. **No blanket globs.** Never emit global `*.png`, `*.svg`, `*.json`, `*.md`, `bin/`, or `env/`.
4. **Merge incrementally.** Preserve valid rules in existing `.antigravityignore`.
5. **Confirm security/repo edits.** Never auto-edit `~/.gemini/config/config.json` (JSON only); confirm before patching `.gitignore` or `git rm --cached`.
6. **Never expose secrets.** Report paths/categories only.

## Workflow

1. **Audit** via [audit_workspace.mjs](./scripts/audit_workspace.mjs) (`--json` for JSON):
   ```bash
   node ./scripts/audit_workspace.mjs "<workspace_dir>" --format md --top 12
   ```
   Review totals, stacks, depth 1–2 bloat, sensitive paths (`.env.example` excluded), and root/nested `.gitignore` leaks (tracked files flagged).

2. **Layer 3 (`.antigravityignore`):** Draft or merge 5 sections—workspace bloat, stack deps/lockfiles/caches, heavy archives/media, local env/keys (`!.env.example`), and `# ` optional toggles.

3. **Layer 2 & Layer 1:**
   - **Layer 2 (`.gitignore`):** Show per-repo patches and `git rm --cached` commands; apply only after confirmation.
   - **Layer 1 (`permissions.deny`):** Output JSON for manual setup in **Settings → Security / Permissions (Strict Mode)** or `~/.gemini/config/config.json`.

4. **Optional sync (on request)** via [sync_ignores.mjs](./scripts/sync_ignores.mjs):
   ```bash
   node ./scripts/sync_ignores.mjs "<workspace_dir>" --targets .geminiignore,.aiexclude --dry-run
   node ./scripts/sync_ignores.mjs "<workspace_dir>" --targets .geminiignore,.aiexclude --backup
   ```

5. **Verify:** Re-read `.antigravityignore` (clean grouping, no blanket traps, active code intact), report files/MB saved, and re-run `audit_workspace.mjs` if `.gitignore` changed.
