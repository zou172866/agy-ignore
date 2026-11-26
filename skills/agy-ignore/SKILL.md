---
name: agy-ignore
description: Audit-first .antigravityignore & .gitignore leak guard (Ignore Guard / set up AI ignore / 禁区助手 / 禁区管家 / 建立禁区 / 屏蔽垃圾).
---

# agy-ignore (Ignore Guard / 禁区助手 · 禁区管家)

Build rules from real metrics, never static templates. Read [guardrails.md](./references/guardrails.md) on demand for Strict Mode, mixed dirs, `.aiexclude`, or reporting.

## Triggers

- **Default** (`Ignore Guard` / `set up AI ignore` / `禁区助手` / `禁区管家` / `建立禁区` / `屏蔽垃圾` / `/agy-ignore`): audit → write/merge `.antigravityignore` (DSH: `.dshignore`) → `--verify` → summary.
- **Read-only** (`audit only` / `check` / `只看` / `体检`): Step 1 only; no edits.
- **Sync** (`sync` / `全同步`): default + Step 4 sync (`.geminiignore`, `.aiexclude`, `.dshignore`).

## Invariants

1. **Audit first** (read-only).
2. **Protect code**: inspect mixed dirs (`data/`, `models/`) first; put borderline dirs (`04-cleaned/`, datasets) in `# ` toggles.
3. **No blanket globs**: never emit `*.png`, `*.svg`, `*.json`, `*.md`, `bin/`, or `env/`.
4. **Merge incrementally**; preserve user rules.
5. **Confirm repo/security edits**: never edit `~/.gemini/config/config.json` (JSON only); confirm `.gitignore` / `git rm --cached`.
6. **Never expose secrets**: paths/categories only.

## Workflow

1. **Audit** ([audit_workspace.mjs](./scripts/audit_workspace.mjs), `--json` for JSON):
   ```
   node ./scripts/audit_workspace.mjs "<workspace_dir>" --format md --top 12
   ```
   Skim root `.gitignore` for runtime dirs while keeping active scripts readable.
2. **Layer 3 (`.antigravityignore` / `.dshignore`)**: write/merge 5 sections—bloat/state, deps/locks/caches, archives/weights/media, env/keys (`!.env.example`), `# ` toggles.
3. **Verify**: check written file & fix `WARN` (DSH: `--ignore-file .dshignore`):
   ```
   node ./scripts/audit_workspace.mjs "<workspace_dir>" --verify
   ```
4. **Sync** ([sync_ignores.mjs](./scripts/sync_ignores.mjs), only on `sync`/`全同步` or existing targets):
   ```
   node ./scripts/sync_ignores.mjs "<workspace_dir>" --targets .geminiignore,.aiexclude --dry-run
   node ./scripts/sync_ignores.mjs "<workspace_dir>" --targets .geminiignore,.aiexclude --backup
   ```
5. **Report**: reassure first (active, 0 deleted, reversible) + `--verify` savings; rank next steps (**Leaks** → fix & rotate if tracked; **Preventive `.gitignore`** → quick win; **Hard wall** → signpost vs lock, optional; omit sync unless asked/present); end with one easy reply.
