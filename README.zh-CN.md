# AgentSkills

跨平台桌面应用，用于管理 AI 代理技能。通过统一界面浏览、安装、同步和编辑 13 个代理的技能。

[English](./README.md)

## 支持的代理

| 代理 | 格式 | 技能目录 |
|------|------|---------|
| Claude Code | SKILL.md | `~/.claude/skills` |
| Cursor | SKILL.md | `~/.cursor/skills` |
| Codex | SKILL.md | `~/.codex/skills` |
| Gemini CLI | gemini-extension | `~/.gemini/skills` |
| GitHub Copilot CLI | SKILL.md | `~/.copilot/skills` |
| Kiro | SKILL.md | `~/.kiro/skills` |
| OpenCode | SKILL.md | `~/.opencode/skills` |
| Antigravity | SKILL.md | `~/.antigravity/skills` |
| CodeBuddy | SKILL.md | `~/.codebuddy/skills` |
| OpenClaw | SKILL.md | `~/.openclaw/skills` |
| Trae | SKILL.md | `~/.trae/skills` |
| Windsurf | SKILL.md | `~/.codeium/windsurf/skills` |
| Cline | SKILL.md | `~/.cline/skills` |

## 功能

- **仪表盘** — 查看已安装的代理及每个代理的技能数量
- **技能管理** — 查看、编辑、卸载技能，跨代理同步
- **市场** — 从 [skills.sh](https://skills.sh) 和 [ClawHub](https://clawhub.ai) 浏览并安装技能
- **技能编辑器** — 在应用内直接编辑 SKILL.md 文件
- **文件监听** — 磁盘上技能变化时自动刷新
- **跨代理同步** — 一键将技能从一个代理同步到所有其他代理

## 技术栈

**前端：** React 19、TypeScript、Tailwind CSS 4、shadcn/ui

**原生核心层：** Rust、Tauri 2、SQLite

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (stable)
- Tauri 平台依赖 — 参见 [Tauri 环境配置](https://v2.tauri.app/start/prerequisites/)

### 开发

```bash
# 安装依赖
npm install

# 启动开发环境（Vite + Tauri）
npm run tauri dev

# 仅前端（端口 1420）
npm run dev

# 类型检查
npx tsc

# Rust 测试
cd src-tauri && cargo test
```

### 构建

```bash
npm run tauri build
```

产出：
- **macOS：** `AgentSkills.app` + `.dmg`
- **Windows：** `.msi` + `.exe`
- **Linux：** `.AppImage` + `.deb`

## 架构

```
src/                          # React 前端
├── pages/                    # 仪表盘、技能管理、市场、设置
├── components/               # 布局、shadcn/ui 组件
└── hooks/                    # useAgents、useSkills（React Query）

src-tauri/
├── agents/*.toml             # 声明式代理配置
└── src/
    ├── commands/             # Tauri IPC 命令处理
    ├── scanner/engine.rs     # 扫描技能目录
    ├── installer/            # 安装/卸载技能
    ├── parser/skillmd.rs     # SKILL.md YAML 前置解析器
    ├── marketplace/          # skills.sh 抓取 + ClawHub API 客户端
    ├── registry/loader.rs    # 加载代理 TOML 配置，检测已安装代理
    └── watcher.rs            # 文件监听 → 向前端发送事件
```

### 数据流

1. Registry 加载代理 TOML 配置，通过目录/CLI 检测已安装的代理
2. Scanner 遍历每个代理的技能目录，Parser 提取 SKILL.md 前置元数据
3. 跨代理按 ID 去重技能
4. 文件监听器监控目录变化，发送 `skills-changed` 事件
5. 前端通过 TanStack Query 缓存失效机制订阅事件

