---
name: agy-ignore
description: Audit-first .antigravityignore & .gitignore leak guard (Ignore Guard / set up AI ignore / 禁区管家 / 建立禁区 / 屏蔽垃圾).
---

# agy-ignore (Ignore Guard / 禁区管家)

Build rules from real metrics, never static templates. Read [guardrails.md](./references/guardrails.md) on demand for Strict Mode, mixed dirs, `.aiexclude`, or reporting tips.

## Triggers

- **Default** (`Ignore Guard` / `set up AI ignore` / `禁区管家` / `建立禁区` / `屏蔽垃圾` / `/agy-ignore`): audit → write/merge `.antigravityignore` → `--verify` → plain-language summary + ranked recommendations. Run directly; no upfront questions.
- **Read-only** (`audit only` / `check` / `只看` / `体检`): Step 1 only; no edits.
- **Sync** (`sync` / `全同步`): default + Step 4 sync to `.geminiignore` & `.aiexclude`.

## Invariants

1. **Audit first** (read-only).
2. **Protect code**: inspect mixed dirs (`data/`, `models/`) first; put borderline dirs (`04-cleaned/`, datasets) in `# ` toggles.
3. **No blanket globs**: never emit `*.png`, `*.svg`, `*.json`, `*.md`, `bin/`, or `env/`.
4. **Merge incrementally**; preserve user rules.
5. **Confirm repo/security edits**: never edit `~/.gemini/config/config.json` (JSON only); confirm before `.gitignore` patches or `git rm --cached`.
6. **Never expose secrets**: paths/categories only.

## Workflow

1. **Audit** ([audit_workspace.mjs](./scripts/audit_workspace.mjs), `--json` for JSON):
   ```
   node ./scripts/audit_workspace.mjs "<workspace_dir>" --format md --top 12
   ```
   Skim root `.gitignore` for runtime dirs while keeping active scripts readable.
2. **Layer 3 (`.antigravityignore`)**: write/merge 5 sections—bloat/state, deps/locks/caches, archives/weights/media, env/keys (`!.env.example`), `# ` toggles.
3. **Verify**: check written `.antigravityignore` and fix any `WARN`:
   ```
   node ./scripts/audit_workspace.mjs "<workspace_dir>" --verify
   ```
4. **Sync** ([sync_ignores.mjs](./scripts/sync_ignores.mjs), only on `sync`/`全同步` or existing targets):
   ```
   node ./scripts/sync_ignores.mjs "<workspace_dir>" --targets .geminiignore,.aiexclude --dry-run
   node ./scripts/sync_ignores.mjs "<workspace_dir>" --targets .geminiignore,.aiexclude --backup
   ```
5. **Report**: reassure first (active, 0 files deleted, reversible) + `--verify` savings; rank next steps (**Leaks** → fix now & rotate if tracked; **Preventive `.gitignore`** → quick win; **Hard wall** → 1-line signpost vs lock, optional; omit sync unless asked/present); end with one easy reply.
