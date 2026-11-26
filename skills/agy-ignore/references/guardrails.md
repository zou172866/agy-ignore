# agy-ignore — Three-Layer Guardrails & Anti-Patterns

Ignore files are **soft context filters**, never a security boundary.

## 1. Three-Layer Boundary

| Layer | Mechanism | Security? | Scope & Goal |
| --- | --- | --- | --- |
| **L1: Hard Wall** | Antigravity: `permissions.deny` + Strict Mode; DSH: sandbox/presets + `agy-dart` guard | **Yes** | Blocks reads of `.env*`, keys, `secrets/`, profiles, local `config.json` |
| **L2: Repo Baseline** | `.gitignore` (root + nested repos) | Commit guard | Blocks staging secrets, profiles, deps, weights, exports |
| **L3: Context Filter** | `.antigravityignore` / `.dshignore` (sync: `.geminiignore`, `.aiexclude`) | **No** | Cuts bloat from caches, lockfiles, weights, archives, state, corpora |

## 2. Operational Caveats

- **L1 & Strict Mode:** Never auto-edit `~/.gemini/config/config.json`. Shell/direct reads bypass L3—pair L1 with **Strict Mode**; keep `.env.example` readable.
- **DSH:** `glob`/`grep` use `--no-ignore --hidden`; `.dshignore` serves `dsh-plugin-ignore`/`agy-dart`, never replaces `.gitignore`/L1.
- **Nested repos:** Root `.gitignore` skips nested `sub-repo/.git`; patch separately.
- **Tracked files:** `.gitignore` won't untrack—confirm `git rm --cached`; rotate pushed secrets.
- **Leaks vs hardening:** Unignored/tracked → **fix now**; missing secret rules (0 leaks) → **quick win**.
- **False positives:** Public CA `.pem` (no `PRIVATE KEY`) & zero-secret ML `config.json` skip `permissions.deny`.
- **`.aiexclude` negation:** Some parsers restrict `!pattern` (`!.env.example`)—check synced file.

## 3. Anti-Patterns (Never Emit Blindly)

| Anti-Pattern | Failure Mode | Safe Alternative |
| --- | --- | --- |
| `*.png`, `*.svg`, `*.jpg` | Hides diagrams, icons | Scope to bulky dirs (`assets/raw-photos/`) |
| `*.json` | Hides `package.json` | Scope to private files (`app/config.json`) |
| `*.md` | Hides `README.md` | Ignore raw/chunk dirs (`txt/01-raw/`) |
| Global `bin/` or `env/` | Hides CLI scripts or `env/` code | Scope per project (`dotnet-app/bin/`) |
| Whole mixed dir (`data/`, `models/`) | Hides scripts (`data/*.ps1`) or ORM code | Require `codeFiles === 0`; ignore runtime subpaths only |
| `.env.*` w/o `!.env.example` | Hides env templates | Pair with `!.env.example`/`.sample`/`.template` |
| Ignoring outputs | Blinds deliverables (`04-cleaned/`) | Use `# ` toggles |

## 4. Plain-Language Delivery

Lead with reassurance (active, 0 files deleted, reversible) + `--verify` savings; rank next steps (**Fix now / Quick win / Optional**); contrast L3 vs L1 in one line (signpost vs lock); omit sync unless asked/present; end with one reply choice.
