**English** | [简体中文](./README.zh-CN.md)

# agy-ignore

[![Clones](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/zou172866/repo-traffic-archive/main/badges/agy-ignore.json)](https://github.com/zou172866/repo-traffic-archive)

**Keep AI out of junk files and secrets — save quota, stay safe.**

Audit-first workspace bloat analysis and three-layer ignore-rule tool & skill (**Ignore Guard**) for Google Antigravity, Gemini CLI, and Gemini Code Assist.

Zero external dependencies · Node.js >= 18 · Windows / macOS / Linux · Ultra-light ~30-token Skill card (just say **"Ignore Guard, set up AI ignore"**) + 0-prompt-token CLI (`agy-ignore`) & Windows drag-and-drop / right-click shortcuts.

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
# Isolated verification against the written .antigravityignore:
node skills/agy-ignore/scripts/audit_workspace.mjs /path/to/workspace --verify
```

What `audit_workspace.mjs` inspects (without following directory symlinks or scanning `.git/` internals):
- **Workspace overview:** total files, total MB, detected tech stacks, and existing ignore files (`.gitignore`, `.antigravityignore`, `.geminiignore`, `.aiexclude`, `.cursorignore`).
- **Top bloat directories (depth 1 & 2):** ranked by both size and file count with automatic noise categories (`browser_profile`, `dependencies`, `build_cache`, `archives_releases`, `corpus_or_intermediate`, `model_media_assets`, `lockfiles`), protecting mixed dirs (`data/`, ORM `models/`, frontend `state/`) that contain active code.
- **Sensitive files, weights & profiles:** `.env` / `.env.*` (excluding `.env.example`/`.env.sample`/`.env.template`), `*.pem` (auto-triages public-only CA certs while strictly flagging private keys and mixed cert+key bundles), `*.key`, `*.dpapi` (dynamic), `secrets/`, browser profiles, `.remotion/` cache, SQLite WAL/SHM companions (`*.sqlite*-wal`/`-shm`), AI weight dirs & binaries (`pretrained_models/`, `*_weights*`, `*.ckpt`/`*.pth`/`*.onnx`/`*.safetensors`/`*.gguf`), and local `config.json` (auto-skips zero-secret ML hyperparameter configs so `permissions.deny` stays noise-free).
- **Multi-repo `.gitignore` leak & hardening audit (depth <= 2):** runs `git check-ignore --no-index` and `git ls-files` per repo to separate **Active Leaks** (fix now) from **Preventive Hardening** (optional `.env.*` / `*.pem` / `*.key` hygiene when 0 files currently leak).
- **Actionable outputs & isolated `--verify`:** deduplicated savings estimate, 5-section `.antigravityignore` draft, real-file `--verify` check (verifying exact filtered files/MB, `.env.example` readability, and 0 accidentally ignored Git-tracked code files), and plain-language prioritized recommendations.

### 2. Optional Multi-Tool Sync

When you also use **Gemini CLI** (`.geminiignore`) or **Gemini Code Assist** (`.aiexclude`):

```bash
node skills/agy-ignore/scripts/sync_ignores.mjs /path/to/workspace --targets .geminiignore,.aiexclude --dry-run
node skills/agy-ignore/scripts/sync_ignores.mjs /path/to/workspace --targets .geminiignore,.aiexclude --backup
```

`sync_ignores.mjs` adds a generated-from header and refuses to overwrite differing existing files unless `--backup` or `--force` is passed.

---

## Installation & Zero-Prompt-Token Modes

### Mode 1: Global CLI Tool (`agy-ignore`, **0 permanent prompt tokens**, Recommended)

Run `agy-ignore` inside any AI chat (**"run `agy-ignore` and help me review"**) or terminal without keeping any skill in your permanent system prompt:

```bash
git clone https://github.com/zou172866/agy-ignore.git
cd agy-ignore
npm link
```

Usage anywhere:
```bash
agy-ignore                  # Interactive menu in terminal; read-only report + Agent Guardrails in LLM/non-TTY
agy-ignore --check          # Read-only audit report + Agent Guardrails (no file edits)
agy-ignore --apply          # Create or incrementally merge .antigravityignore (preserves existing rules)
agy-ignore --verify         # Verify written .antigravityignore (real savings + tracked-code safety)
agy-ignore --sync           # Apply .antigravityignore + backup-sync .geminiignore & .aiexclude
agy-ignore --fix-gitignore  # Append unignored leak rules to repo .gitignore files (never auto-untracks)
```

### Mode 2: Windows Drag-and-Drop / Double-Click / Right-Click Menu

- Drag any project folder onto `windows/agy-ignore.bat` (or double-click it to open the native folder picker).
- Run `windows/install-windows-menu.bat` once (no admin needed; writes user-only `HKCU` registry) to add **Explorer right-click menu** + **Desktop shortcut** (`windows/uninstall-windows-menu.bat` cleanly removes both).

### Mode 3: Antigravity / Gemini Skill (~30 tokens idle, natural-language triggers)

```bash
# Via skills.sh (ready out of the box)
npx -y skills add zou172866/agy-ignore -g --all

# Via Gemini CLI
gemini skills install https://github.com/zou172866/agy-ignore.git --path skills/agy-ignore

# Local global Antigravity install / check / uninstall
npm run install:local
npm run check:local
npm run uninstall:local
```

Once installed, just say in any project chat:
- **`Ignore Guard, set up AI ignore`** (or **`/agy-ignore`**) — audit and write/merge `.antigravityignore`
- **`Ignore Guard, audit only`** — read-only report, no file edits
- **`Ignore Guard, sync`** — also backup-sync `.geminiignore` & `.aiexclude`

`skills/agy-ignore/` is **100% self-contained** (relative links only, ~114-char trigger card) and compatible with OpenSpace.

---

## Repository Layout & Tests

```text
agy-ignore/
├── bin/
│   └── agy-ignore.mjs
├── windows/
│   ├── agy-ignore.bat
│   ├── install-windows-menu.bat
│   └── uninstall-windows-menu.bat
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
│   ├── audit_workspace.test.mjs
│   └── cli_tool.test.mjs
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
