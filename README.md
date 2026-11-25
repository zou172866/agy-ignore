**English** | [简体中文](./README.zh-CN.md)

# agy-ignore

**Audit-first workspace bloat analysis and three-layer ignore-rule customization skill for Google Antigravity, Gemini CLI, and Gemini Code Assist.**

Zero external dependencies · Node.js >= 18 · Windows / macOS / Linux · UTF-8 & CJK path safe · Ultra-compact 4-file self-contained skill (`skills/agy-ignore/`: 39-line `SKILL.md` with <200-char trigger description for minimal per-turn token overhead).

---

## Why Static Ignore Templates Fail

Copy-pasting a generic `.antigravityignore` template breaks in both directions:

1. **Misses real workspace bloat:** Real projects hide hundreds of megabytes and thousands of files inside non-standard paths—Edge/Playwright browser profiles (`.edge-profile/`), ASR/NLP intermediate chunks (`txt/03-chunks/`, `01-raw/`), release archives (`*-releases/`), or batch exports (`output/`).
2. **Breaks active workflows:** Over-aggressive templates blanket-ignore `*.png`, `*.svg`, `*.json`, `*.md`, or `bin/`, silently blinding AI agents to UI screenshots, `package.json`, manifests, handoff docs, and CLI scripts.
3. **Confuses noise filtering with security:** `.antigravityignore` is a **soft context filter**, not a security wall. Secrets also need Git hygiene (`.gitignore`) and hard tool blocks (`permissions.deny`).

`agy-ignore` enforces an **audit-first workflow**: measure actual file counts, sizes, sensitive paths, and multi-repo `.gitignore` leaks first, then generate or incrementally merge a tailored configuration.

---

## Three-Layer Defense Architecture

| Layer | Mechanism | Enforces Security? | Purpose |
| --- | --- | --- | --- |
| **Layer 1: Hard Security Wall** | `permissions.deny` + Strict Mode (`~/.gemini/config/config.json` or Antigravity Settings) | **Yes** | Blocks AI tools from reading `.env*`, `*.pem`, `*.key`, `secrets/`, browser profiles, and local `config.json` |
| **Layer 2: Repo Baseline** | `.gitignore` (root + each nested Git repo) | Prevents commits | Catches unignored or already-tracked secrets, profiles, dependencies, and heavy exports |
| **Layer 3: AI Context Filter** | `.antigravityignore` (optionally synced to `.geminiignore` / `.aiexclude`) | **No** (soft filter) | Eliminates token bloat and search pollution from caches, lockfiles, archives, and intermediate corpora |

See [skills/agy-ignore/references/guardrails.md](./skills/agy-ignore/references/guardrails.md) for boundary caveats, `.aiexclude` negation portability, and anti-patterns.

---

## Audit-First Workflow

### 1. Run Read-Only Workspace Audit

```bash
node skills/agy-ignore/scripts/audit_workspace.mjs /path/to/workspace --format md --top 12
# Programmatic JSON output:
node skills/agy-ignore/scripts/audit_workspace.mjs /path/to/workspace --json
```

What `audit_workspace.mjs` inspects (without following directory symlinks or scanning `.git/` internals):
- **Workspace overview:** total files, total MB, detected tech stacks, and existing ignore files (`.gitignore`, `.antigravityignore`, `.geminiignore`, `.aiexclude`, `.cursorignore`).
- **Top bloat directories (depth 1 & 2):** ranked by both size and file count with automatic noise categories (`browser_profile`, `dependencies`, `build_cache`, `archives_releases`, `corpus_or_intermediate`, `lockfiles`).
- **Sensitive files & profiles:** `.env` / `.env.*` (excluding `.env.example`/`.env.sample`/`.env.template`), `*.pem`, `*.key`, `secrets/`, browser profiles, and local `config.json` paired with `config.example.json` or gitignored.
- **Multi-repo `.gitignore` leak audit (depth <= 2):** runs `git check-ignore --no-index` and `git ls-files` per repo to flag unignored leaks and already-tracked files.
- **Actionable outputs:** deduplicated savings estimate, 5-section `.antigravityignore` draft (borderline outputs placed in commented toggles), per-repo `.gitignore` patch suggestions, and a copy-pasteable `permissions.deny` JSON snippet.

### 2. Optional Multi-Tool Sync

When you also use **Gemini CLI** (`.geminiignore`) or **Gemini Code Assist** (`.aiexclude`):

```bash
node skills/agy-ignore/scripts/sync_ignores.mjs /path/to/workspace --targets .geminiignore,.aiexclude --dry-run
node skills/agy-ignore/scripts/sync_ignores.mjs /path/to/workspace --targets .geminiignore,.aiexclude --backup
```

`sync_ignores.mjs` adds a generated-from header and refuses to overwrite differing existing files unless `--backup` or `--force` is passed.

---

## Installation

### Via `skills.sh` (Recommended for community installs)

```bash
npx -y skills add zou172866/agy-ignore -g --all
```

### Via Gemini CLI

```bash
gemini skills install https://github.com/zou172866/agy-ignore.git --path skills/agy-ignore
```

### Local Clone & Global Antigravity Install

```bash
git clone https://github.com/zou172866/agy-ignore.git
cd agy-ignore
npm run install:local
npm run check:local
```

This syncs `skills/agy-ignore/` to `~/.gemini/config/skills/agy-ignore/` (e.g. `C:\Users\<user>\.gemini\config\skills\agy-ignore\` on Windows) and verifies exact file list + SHA-256 content hashes with zero drift. Remove anytime with `npm run uninstall:local`.

### OpenSpace Compatibility

`skills/agy-ignore/` is **100% self-contained**—every script and reference link inside `SKILL.md` uses relative paths (`./scripts/...`, `./references/...`). It can be uploaded directly to OpenSpace or copied into any agent skills directory with zero broken links.

---

## Repository Layout & Tests

```text
agy-ignore/
├── skills/agy-ignore/
│   ├── SKILL.md
│   ├── scripts/
│   │   ├── audit_workspace.mjs
│   │   └── sync_ignores.mjs
│   └── references/
│       └── guardrails.md
├── scripts/
│   └── install-local.mjs
├── tests/
│   └── audit_workspace.test.mjs
├── package.json
├── README.md
├── README.zh-CN.md
└── LICENSE
```

Run the built-in zero-dependency test suite (`node --test`):

```bash
npm test
```

## Recommended GitHub Topics

`antigravity` · `google-antigravity` · `agent-skills` · `antigravityignore` · `gemini-cli` · `geminiignore` · `aiexclude` · `context-engineering` · `developer-tools`

## License

[MIT](./LICENSE) © 2026 zou172866
