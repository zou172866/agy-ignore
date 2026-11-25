---
name: agy-ignore
description: Audit-first workspace bloat & three-layer ignore rules (.antigravityignore, .gitignore leaks, permissions.deny, .geminiignore/.aiexclude). Triggers: /agy-ignore, 配忽略, 加ignore, 项目防噪, 体检忽略.
---

# agy-ignore — Three-Layer Ignore SOP

Build ignore rules from real metrics, never static templates. Consult [guardrails.md](./references/guardrails.md) on demand for Strict Mode, `.aiexclude` negation caveats, or anti-patterns.

## Quick Triggers

- **Default** (`/agy-ignore`, `配忽略`, `加ignore`, `项目防噪`): audit workspace → write/merge `.antigravityignore` → report `.gitignore` leaks & `permissions.deny` → verify. Run directly; no upfront questions.
- **Read-only** (`/agy-ignore 只看` / `check` / `体检忽略`): Step 1 audit & report only; no edits.
- **Sync** (`/agy-ignore 全同步` / `sync`): default flow + Step 4 sync to `.geminiignore` & `.aiexclude`.

## Invariants

1. **Audit first** (read-only) before any edit.
2. **Keep deliverables readable**; put borderline dirs (`04-cleaned/`, datasets) in `# ` toggles.
3. **No blanket globs**: never emit global `*.png`, `*.svg`, `*.json`, `*.md`, `bin/`, or `env/`.
4. **Merge incrementally** into existing `.antigravityignore`; preserve valid user rules.
5. **Confirm repo/security edits**: never auto-edit `~/.gemini/config/config.json` (JSON only); confirm before `.gitignore` patches or `git rm --cached`.
6. **Never expose secrets**: report paths/categories only.

## Workflow

1. **Audit** ([audit_workspace.mjs](./scripts/audit_workspace.mjs), add `--json` for JSON):
   ```bash
   node ./scripts/audit_workspace.mjs "<workspace_dir>" --format md --top 12
   ```
2. **Layer 3 (`.antigravityignore`)**: write/merge 5 sections—workspace bloat, deps/lockfiles/caches, heavy archives/media, env/keys (`!.env.example`), and `# ` toggles.
3. **Layer 2 & 1**: list per-repo `.gitignore` patches + `git rm --cached` (apply only if confirmed), and output `permissions.deny` JSON for **Settings → Security / Permissions (Strict Mode)**.
4. **Optional sync** ([sync_ignores.mjs](./scripts/sync_ignores.mjs), on `全同步`/`sync` or request):
   ```bash
   node ./scripts/sync_ignores.mjs "<workspace_dir>" --targets .geminiignore,.aiexclude --dry-run
   node ./scripts/sync_ignores.mjs "<workspace_dir>" --targets .geminiignore,.aiexclude --backup
   ```
5. **Verify**: confirm clean grouping, active code intact, report files/MB saved, and re-run audit if `.gitignore` changed.
