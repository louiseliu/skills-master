# AgentSkills

A cross-platform desktop app for managing AI agent skills. Browse, install, sync, and edit skills across 13 agents from a single interface.

## Supported Agents

| Agent | Format | Skills Directory |
|-------|--------|-----------------|
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

## Features

- **Dashboard** — See which agents are installed, how many skills each has
- **Skills Manager** — View, edit, uninstall, and sync skills across agents
- **Marketplace** — Browse and install skills from [skills.sh](https://skills.sh) and [ClawHub](https://clawhub.ai)
- **Skill Editor** — Edit SKILL.md files directly in the app
- **File Watcher** — Auto-refreshes when skills change on disk
- **Cross-Agent Sync** — Install a skill to one agent, sync it to all others in one click

## Tech Stack

**Frontend:** React 19, TypeScript, Tailwind CSS 4, shadcn/ui

**Native Core:** Rust, Tauri 2, SQLite

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (stable)
- Platform-specific Tauri dependencies — see [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

### Development

```bash
# Install dependencies
npm install

# Run in development (starts Vite + Tauri)
npm run tauri dev

# Frontend only (port 1420)
npm run dev

# Type check
npx tsc

# Rust tests
cd src-tauri && cargo test
```

### Build

```bash
npm run tauri build
```

Outputs:
- **macOS:** `AgentSkills.app` + `.dmg`
- **Windows:** `.msi` + `.exe`
- **Linux:** `.AppImage` + `.deb`

## Architecture

```
src/                          # React frontend
├── pages/                    # Dashboard, Skills, Marketplace, Settings
├── components/               # Layout, shadcn/ui components
└── hooks/                    # useAgents, useSkills (React Query)

src-tauri/
├── agents/*.toml             # Declarative agent configs
└── src/
    ├── commands/             # Tauri IPC handlers
    ├── scanner/engine.rs     # Scans skill directories
    ├── installer/            # Install/uninstall skills
    ├── parser/skillmd.rs     # SKILL.md YAML frontmatter parser
    ├── marketplace/          # skills.sh scraper + ClawHub API client
    ├── registry/loader.rs    # Loads agent TOML configs, detects installed agents
    └── watcher.rs            # File system watcher → emits events to frontend
```

### Data Flow

1. Registry loads agent TOML configs and detects which agents are installed (via directory/CLI detection)
2. Scanner walks each agent's skill directories, parser extracts SKILL.md frontmatter
3. Skills are deduplicated by ID across agents
4. File watcher monitors directories and emits `skills-changed` events
5. Frontend subscribes to events via TanStack Query cache invalidation

---

[中文文档](./README.zh-CN.md)
