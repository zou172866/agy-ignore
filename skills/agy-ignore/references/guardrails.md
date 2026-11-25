# agy-ignore — Three-Layer Guardrails & Anti-Patterns

Ignore files are **soft context filters**, never a security boundary.

## 1. Three-Layer Boundary

| Layer | Mechanism | Security? | Scope & Goal |
| --- | --- | --- | --- |
| **L1: Hard Wall** | `permissions.deny` + Strict Mode (`~/.gemini/config/config.json`) | **Yes** | Blocks AI reads of `.env*`, keys, `secrets/`, browser profiles, local `config.json`, sensitive state dirs |
| **L2: Repo Baseline** | `.gitignore` (root + nested repos) | Commit guard | Blocks staging secrets, profiles, deps, weights, exports |
| **L3: Context Filter** | `.antigravityignore` (sync: `.geminiignore`, `.aiexclude`) | **No** | Cuts bloat from caches, lockfiles, weights, archives, runtime state, intermediate corpora |

## 2. Operational Caveats

- **L1 & Strict Mode:** Never auto-edit `~/.gemini/config/config.json`. Direct `@file` reads & shell bypass L3—pair `permissions.deny` with **Strict Mode**; keep `.env.example` readable.
- **Nested repos:** Root `.gitignore` does **not** protect nested `sub-repo/.git`; patch separately.
- **Tracked files:** `.gitignore` will not untrack them—confirm before `git rm --cached`; rotate pushed secrets immediately.
- **Leaks vs hardening:** Flag real unignored/tracked paths as **fix now**; label missing `.env.*`/`*.pem`/`*.key` rules (0 active leaks) as **optional quick win**.
- **`.aiexclude` negation:** Some parsers restrict `!pattern` (`!.env.example`)—verify synced `.aiexclude`.

## 3. Anti-Patterns (Never Emit Blindly)

| Anti-Pattern | Failure Mode | Safe Alternative |
| --- | --- | --- |
| `*.png`, `*.svg`, `*.jpg` | Hides diagrams, icons | Scope to bulky dirs (`assets/raw-photos/`) |
| `*.json` | Hides `package.json`, schemas | Scope to private files (`app/config.json`) |
| `*.md` | Hides `README.md`, specs | Ignore raw/chunk dirs (`txt/01-raw/`) |
| Global `bin/` or `env/` | Hides CLI scripts or `env/` code | Scope per project (`dotnet-app/bin/`) |
| Whole mixed dir (`data/`, `models/`) | Hides scripts (`data/*.ps1`) or ORM code | Require `codeFiles === 0`; ignore runtime subpaths only |
| `.env.*` w/o `!.env.example` | Hides env templates | Pair with `!.env.example`/`.sample`/`.template` |
| Ignoring deliverables | Blinds AI to outputs (`04-cleaned/`) | Place under `# ` toggles |

## 4. Plain-Language Delivery

Lead with reassurance (active, zero files deleted, reversible) + `--verify` savings; rank next steps (**Fix now / Quick win / Optional**); explain L3 vs L1 in one line (signpost vs lock); omit multi-tool sync unless asked/present; end with one easy reply choice.
