# agy-ignore — Three-Layer Guardrails & Anti-Patterns

Ignore files are **soft context filters**, never a security boundary.

## 1. Three-Layer Boundary

| Layer | Mechanism | Security? | Scope & Goal |
| --- | --- | --- | --- |
| **L1: Hard Wall** | `permissions.deny` + Strict Mode (`~/.gemini/config/config.json` / Settings) | **Yes** | Blocks AI reads of `.env*`, keys, `secrets/`, browser profiles, local `config.json` |
| **L2: Repo Baseline** | `.gitignore` (root + nested Git repos) | Commit guard | Blocks staging secrets, profiles, deps, heavy exports |
| **L3: Context Filter** | `.antigravityignore` (sync: `.geminiignore`, `.aiexclude`) | **No** | Cuts index/search bloat from caches, lockfiles, archives, intermediate corpora |

## 2. Operational Caveats

- **Layer 1 & Strict Mode:** Never auto-edit `~/.gemini/config/config.json`. Direct `@file` reads and shell commands bypass L3 soft ignores—pair `permissions.deny` (`Read(.env*)`, `Read(**/*.pem)`, `Read(**/.edge-profile/**)`) with **Strict Mode**; keep `.env.example` readable.
- **Independent nested repos:** Root `.gitignore` does **not** protect nested `sub-repo/.git`; patch each repo separately.
- **Tracked files ignore `.gitignore`:** Rules do not untrack committed paths. After confirmation, run `git rm --cached -- "<file>"` or `git rm -r --cached -- "<dir>/"`.
- **Rotate pushed secrets:** Untracking does not scrub Git history—rotate pushed secrets immediately.
- **`.aiexclude` negation caveat:** `.antigravityignore`/`.geminiignore` support `!pattern` (`!.env.example`), while some `.aiexclude` parsers ignore/restrict negations—verify synced `.aiexclude`.

## 3. Anti-Patterns (Never Emit Blindly)

| Anti-Pattern | Failure Mode | Safe Alternative |
| --- | --- | --- |
| `*.png`, `*.svg`, `*.jpg` | Hides screenshots, diagrams, icons | Scope to bulky dirs (`assets/raw-photos/`) |
| `*.json` | Hides `package.json`, `tsconfig.json`, schemas | Scope to private/bulky files (`app/config.json`, `*_plan.json`) |
| `*.md` | Hides `README.md`, `SKILL.md`, specs | Ignore raw/chunk dirs (`txt/01-raw/`, `txt/03-chunks/`) |
| Global `bin/` or `env/` | Hides CLI scripts or `env/` code | Scope per project (`dotnet-app/bin/`, `py-svc/env/`) |
| `.env.*` w/o `!.env.example` | Hides env templates | Pair with `!.env.example`, `!.env.sample`, `!.env.template` |
| Ignoring final outputs | Blinds AI to deliverables (`04-cleaned/`) | Place under `# ` commented toggles |
| Using `.*ignore` for secrets | Bypassed by direct reads/shell | Mirror in L1 (`permissions.deny`) & L2 (`.gitignore`) |
