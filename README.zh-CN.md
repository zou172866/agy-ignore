[English](./README.md) | **简体中文**

# agy-ignore

[![Clones](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/zou172866/repo-traffic-archive/main/badges/agy-ignore.json)](https://github.com/zou172866/repo-traffic-archive)

**禁区管家（Ignore Guard）——帮 AI 躲开垃圾文件和密码，省额度、不犯傻、不泄密。**

面向 Google Antigravity、Gemini CLI 与 Gemini Code Assist 的“先量化体检、再三层防噪”小工具与技能。

零外部依赖 · Node.js >= 18 · 跨平台 · 超轻 ~30 Token Skill 名片（装完直接说 **「禁区管家帮我建立一下禁区」**）· 同时提供彻底 0 提示词占用的全局命令 `agy-ignore` 与 Windows 拖拽/右键快捷工具。

---

## 为什么静态模板行不通？

直接照抄网上的通用 `.antigravityignore` 模板，往往两边踩坑：

1. **漏掉真正的体积与文件数黑洞**：真实工作区里动辄几百 MB、数千文件的噪音常藏在非标准路径中——例如调试浏览器配置目录（`.edge-profile/`）、ASR/语料中间切片（`txt/03-chunks/`、`01-raw/`）、历史发布包（`*-releases/`）或批量导出目录（`output/`）。
2. **误伤正常开发与排错**：粗暴屏蔽 `*.png`、`*.svg`、`*.json`、`*.md` 或 `bin/`，会让 AI 看不到前端截图、`package.json`、交接文档与 CLI 可执行脚本。
3. **把防噪文件当成安全边界**：`.antigravityignore` 只是**软性上下文过滤器**，不能替代 Git 忽略（`.gitignore`）和硬权限拦截（`permissions.deny`）。

`agy-ignore` 坚持**先只读体检，再精准定制**：先用脚本实测目录体积、文件数、敏感文件与多仓库 `.gitignore` 漏配，再增量合并规则并把灰区目录放入注释开关。

---

## 三层防护架构

| 防护层 | 机制 | 是否具备硬安全拦截 | 核心目标 |
| --- | --- | --- | --- |
| **第一层：硬安全墙** | `permissions.deny` + Strict Mode（`~/.gemini/config/config.json` 或 Antigravity Settings） | **是** | 从工具权限层禁止 AI 读取 `.env*`、`*.pem`、`*.key`、`secrets/`、浏览器配置目录与本地 `config.json` |
| **第二层：仓库基线** | `.gitignore`（根仓库 + 2 级以内子 Git 仓库） | 防止误提交 | 巡检未忽略或已被 Git 追踪的敏感文件、浏览器 Profile、依赖目录与重型导出物 |
| **第三层：AI 上下文降噪** | `.antigravityignore`（可选同步至 `.geminiignore` / `.aiexclude`） | **否**（软过滤） | 削减锁文件、缓存、归档包与中间切片带来的 Token 消耗和检索噪音 |

详细三层边界、`.aiexclude` 取反规则兼容性与防误杀反模式见 [skills/agy-ignore/references/guardrails.md](./skills/agy-ignore/references/guardrails.md)。

---

## 核心工作流

### 1. 运行只读工作区量化体检

```bash
node skills/agy-ignore/scripts/audit_workspace.mjs /path/to/workspace --format md --top 12
# 输出结构化 JSON：
node skills/agy-ignore/scripts/audit_workspace.mjs /path/to/workspace --json
```

`audit_workspace.mjs` 在安全遍历（不跟随目录软链接、跳过 `.git/` 内部对象、优雅跳过权限受限目录）后输出：
- **工作区总览**：总文件数、总体积（MB）、识别的技术栈、现有 ignore 文件清单（`.gitignore` / `.antigravityignore` / `.geminiignore` / `.aiexclude` / `.cursorignore`）。
- **体积 Top N & 文件数 Top N 目录榜（1～2 级聚合）**：自动标注噪音类型（`browser_profile`、`dependencies`、`build_cache`、`archives_releases`、`corpus_or_intermediate`、`lockfiles`）。
- **敏感文件与浏览器配置扫描**：检测 `.env` / `.env.*`（自动放行 `.env.example` / `.env.sample` / `.env.template`）、`*.pem`、`*.key`、`secrets/`、浏览器 profile，以及与 `config.example.json` 成对出现或已被 gitignore 的本地 `config.json`。
- **多仓库 `.gitignore` 漏配巡检（深度 <= 2）**：对每个 Git 仓库调用 `git check-ignore --no-index` 与 `git ls-files`，标出未忽略项及是否已被 Git 追踪。
- **可直接落地的产出**：去重后的过滤收益估算、5 段分组 `.antigravityignore` 草稿（灰区成品默认写成 `# ` 注释开关）、分仓库 `.gitignore` 补丁清单、以及可直接复制的 `permissions.deny` JSON 片段（绝不擅自修改用户的全局 `config.json`）。

### 2. 可选多端同步（Gemini CLI / Gemini Code Assist）

仅在需要同时维护 `.geminiignore` 或 `.aiexclude` 时运行：

```bash
node skills/agy-ignore/scripts/sync_ignores.mjs /path/to/workspace --targets .geminiignore,.aiexclude --dry-run
node skills/agy-ignore/scripts/sync_ignores.mjs /path/to/workspace --targets .geminiignore,.aiexclude --backup
```

脚本会自动注入同步来源注释头，且在未显式指定 `--backup` 或 `--force` 时绝不静默覆盖内容不同的既有文件。

---

## 安装与零提示词用法

### 方式一：全局命令行工具 `agy-ignore`（**0 常驻提示词占用**，推荐）

不想让低频 Skill 长期占用系统提示词时，用 `npm link` 注册为全局命令即可：

```bash
git clone https://github.com/zou172866/agy-ignore.git
cd agy-ignore
npm link
```

- **在大模型对话里按需调用**：直接说一句 **`跑 agy-ignore 帮我定忽略方案`**，模型运行 `agy-ignore` 会自动拿到紧凑体检报告 + 内置安全红线，无需任何常驻系统提示词。
- **在终端直接运行**：
```bash
agy-ignore                  # 终端里进入单键交互菜单；大模型/脚本调用自动输出只读报告 + 红线提示
agy-ignore --check          # 只读体检，不改任何文件
agy-ignore --apply          # 创建或无损增量合并 .antigravityignore（保留已有用户规则）
agy-ignore --sync           # 写入 .antigravityignore 并备份同步到 .geminiignore 与 .aiexclude
agy-ignore --fix-gitignore  # 补齐未忽略的 .gitignore 高风险漏配（绝不自动取消追踪已提交文件）
```

### 方式二：Windows 免命令行快捷工具（拖放 / 双击 / 右键菜单）

- **拖拽或双击**：把任意项目文件夹直接拖到 `windows/agy-ignore.bat` 上，或双击弹出 Windows 原生目录选择器。
- **一键右键菜单 + 桌面快捷方式**：双击 `windows/install-windows-menu.bat`（只写当前用户 `HKCU`，无需管理员权限），即可在任意文件夹右键调用或直接拖到桌面 `agy-ignore.lnk` 图标；随时双击 `windows/uninstall-windows-menu.bat` 干净卸载。

### 方式三：作为 Antigravity / Gemini Skill 安装（平时仅 ~30 Token，大白话直接叫）

```bash
# 通过 skills.sh（社区用户装完即用）
npx -y skills add zou172866/agy-ignore -g --all

# 通过 Gemini CLI
gemini skills install https://github.com/zou172866/agy-ignore.git --path skills/agy-ignore

# 本机全局 Skill 安装 / 校验 / 卸载
npm run install:local
npm run check:local
npm run uninstall:local
```

装完后在任意项目聊天框里直接说人话就行：
- **「禁区管家帮我建立一下禁区」**（或 **`/agy-ignore`**）→ 自动体检并写入/增量更新 `.antigravityignore`
- **「禁区管家只看一下」** → 只读体检出报告，不改任何文件
- **「禁区管家全同步」** → 写入 `.antigravityignore` 并备份同步 `.geminiignore` 与 `.aiexclude`

`skills/agy-ignore/` 100% 自包含（纯相对路径，仅 ~114 字符超短触发名片），兼容 OpenSpace。

---

## 目录结构与测试

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

运行零依赖自动化测试（内置 `node --test`）：

```bash
npm test
```

## 推荐 GitHub Topics

`antigravity` · `google-antigravity` · `agent-skills` · `antigravityignore` · `gemini-cli` · `geminiignore` · `aiexclude` · `context-engineering` · `developer-tools`

## 开源协议

[MIT](./LICENSE) © 2026 zou172866
