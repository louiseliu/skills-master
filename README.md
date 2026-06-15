<p align="center">
  <img src="src-tauri/icons/icon-rounded.png" width="128" height="128" alt="技能管家">
</p>

<h1 align="center">技能管家 · SkillsMaster</h1>

<p align="center">
  跨平台桌面应用，统一管理 36 款 AI Agent 的技能。<br>
  ✨ <strong>AI 加持</strong>的智能搜索与解读，让 SKILL.md 第一次「会说话」。<br>
  浏览、安装、同步、编辑，一站式搞定。
</p>

<p align="center">
  <a href="https://github.com/louiseliu/skills-master/releases"><img src="https://img.shields.io/github/v/release/louiseliu/skills-master?style=flat-square" alt="Release"></a>
  <a href="https://github.com/louiseliu/skills-master/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-PolyForm%20Noncommercial-orange?style=flat-square" alt="License"></a>
  <a href="https://github.com/louiseliu/skills-master/stargazers"><img src="https://img.shields.io/github/stars/louiseliu/skills-master?style=flat-square" alt="Stars"></a>
</p>

---

## 致谢 / Acknowledgement

本项目最初 fork 自
[**chrlsio/agent-skills**](https://github.com/chrlsio/agent-skills)（MIT License），
在此基础上进行了大量重构与功能扩展。衷心感谢上游作者的开源工作！
详见 [NOTICE.md](./NOTICE.md)。

> Originally forked from
> [**chrlsio/agent-skills**](https://github.com/chrlsio/agent-skills) (MIT License),
> with substantial refactoring and new features. Heartfelt thanks to the upstream
> authors. See [NOTICE.md](./NOTICE.md) for full attribution.

---

## 关于作者

**五柳大叔** — 干的是未来事的大叔 🧓➡️🤖

> 白天聊 Prompt，晚上研究 Agent
> 把复杂的 AI，翻译成人话

---

## 支持的 AI Agent

### 编程 & 开发

| Agent | 类型 | 说明 |
|-------|------|------|
| Claude Code | CLI | Anthropic 官方编程 Agent |
| Cursor | IDE | AI-first 代码编辑器 |
| Codex | CLI | OpenAI 编程 Agent |
| Gemini CLI | CLI | Google AI 命令行工具 |
| GitHub Copilot CLI | CLI | GitHub 代码助手 |
| Cline | IDE 插件 | VS Code AI 助手 |
| Trae | IDE | 字节跳动 AI 编辑器 |
| Windsurf | IDE | Codeium AI 编辑器 |
| OpenCode | CLI | 开源编程 Agent |
| Kiro | IDE | AWS 出品 AI 编辑器 |
| Factory | CLI | AI 编程工具 |
| Warp | 终端 | AI 原生终端 |
| Qoder | IDE 插件 | AI 编程助手 |
| CodeBuddy | IDE | 腾讯 AI 代码助手 |
| Antigravity | CLI | AI Agent 框架 |

### 龙虾家族（OpenClaw 生态）

| Agent | 出品方 | 说明 |
|-------|--------|------|
| OpenClaw | 社区 | 开源个人 AI 助手框架，36 万 GitHub Stars |
| AutoClaw | 智谱 AI | 一键部署 OpenClaw 桌面客户端 |
| QClaw | 腾讯 | 腾讯出品，微信直连龙虾助手 |
| LobsterAI | 网易有道 | 有道龙虾，桌面全场景 AI 助理 |
| DuMate | 百度 | 办公搭子，桌面级 AI 智能体 |
| 360Claw | 360 | 360 安全龙虾，自带安全铠甲 |
| WorkBuddy | 腾讯 | AI 原生桌面智能体工作台 |
| Manus | Manus AI | 通用 AI Agent 平台 |
| LobeHub | LobeHub | 开源 AI 对话框架 |
| Wukong | 社区 | 悟空龙虾 |
| StepBuddy | 阶跃星辰 | 阶跃 AI 助手 |
| QoderWork | 腾讯 | AI 办公工作台 |
| CoPaw | 社区 | AI 协作助手 |
| Nexu | 社区 | AI Agent 运行时 |
| NiuMaAI | 社区 | 牛码 AI |
| MuleRun | 社区 | 自动化任务执行 |
| PoorClaw | 社区 | 轻量龙虾方案 |
| LinkFoxClaw | 社区 | 企业级龙虾 |
| Loomy | 社区 | AI 创意助手 |
| Tabbit | 社区 | AI 标签管理 |
| JvsClaw | 社区 | Java 生态龙虾 |

## ✨ 新功能（近期迭代）

> 这一波重点把 AI 从「附加项」变成「核心交互」，让技能搜索 / 解读不再靠肉眼翻 markdown。

- **🧠 AI 智能搜索** — 用自然语言提问，跨「本地技能 + 在线市场」联合检索，OpenAI 兼容多 provider（OpenAI / DeepSeek / 智谱 / 月之暗面 / 自定义 base_url 等）
- **🌊 SSE 流式打字机** — 4 步进度可视化（收集 → 扫描 → 思考 → 润色），AI 输出实时 typewriter 流入，等待不再焦虑
- **🤖 AI 技能解读** — 一键解释 SKILL.md：核心能力 / 何时触发 / 安装步骤 / 使用示例，告别"长文劝退"
- **🔍 关键词降级搜索** — 未配置 AI 时自动 fallback 到本地关键词匹配，免配置即可用
- **⚡ 一键启用 AI** — 保存 API Key 时自动开启 AI 能力，无需二次操作
- **🌐 网络代理设置** — 内置 HTTP / HTTPS / SOCKS5 代理支持，自动探测系统代理，国内网络也能直连
- **🪟 双向可拖拽布局** — 上下 + 左右 split panel 自由调整，长技能名 / 大段解读都能优雅展开
- **📥 安装到指定 Agent** — 市场技能可精确选择安装目标，多 Agent 环境下井然有序

## 核心功能

- **仪表盘** — 一览所有 Agent 的安装状态与技能数量，龙虾家族自动分组折叠
- **技能管理** — 查看、编辑、卸载技能，支持跨 Agent 一键同步
- **技能市场** — 三大来源：[skills.sh](https://skills.sh)、[ClawHub](https://clawhub.ai)、[SkillHub](https://skillhub.cn)
- **技能编辑器** — 应用内直接编辑 SKILL.md
- **文件监听** — 磁盘技能变动时自动刷新
- **跨 Agent 同步** — 一键将技能同步到所有已安装 Agent
- **批量更新** — 从 Git 上游一键更新所有技能

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19、TypeScript、Tailwind CSS 4、shadcn/ui |
| 原生核心 | Rust、Tauri 2、SQLite |
| 构建 | Vite 7、Cargo |

## 安装

### 方案 A：一行命令安装（推荐）

自动识别操作系统和架构，从 GitHub Releases 下载对应安装包。

**Linux / macOS：**

```bash
curl -fsSL https://raw.githubusercontent.com/louiseliu/skills-master/v1.0.2/install.sh | bash
```

**Windows（PowerShell）：**

```powershell
irm https://raw.githubusercontent.com/louiseliu/skills-master/v1.0.2/install.ps1 | iex
```

支持格式：Linux（`.deb` / `.rpm` / `.AppImage`）| macOS（`.dmg`）| Windows（`.exe` / `.msi`）

### 方案 B：macOS 使用 Homebrew

```bash
brew tap louiseliu/skills-master https://github.com/louiseliu/skills-master
brew install --cask skillsmaster
```

> 遇到 quarantine 问题？加上 `--no-quarantine` 参数。

### 方案 C：手动下载

前往 [GitHub Releases](https://github.com/louiseliu/skills-master/releases) 下载对应平台安装包。

### 常见问题

**macOS 提示"应用已损坏，无法打开"？**

```bash
sudo xattr -rd com.apple.quarantine "/Applications/SkillsMaster.app"
```

## 本地开发

### 环境要求

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://rustup.rs/) stable
- [Tauri 平台依赖](https://v2.tauri.app/start/prerequisites/)

### 开发命令

```bash
npm install            # 安装依赖
npm run tauri dev      # 启动开发环境（Vite + Tauri）
npm run dev            # 仅前端（端口 1420）
npx tsc                # 类型检查
cd src-tauri && cargo test  # Rust 测试
```

### 构建

```bash
npm run tauri build
```

## 贡献

欢迎贡献！请先开 Issue 讨论你想做的改动。

## 社区

- [LINUX DO](https://linux.do/)

## 许可证

本项目基于 **[PolyForm Noncommercial License 1.0.0](./LICENSE)** 发布。

### ✅ 免费使用场景

- 个人学习、研究、实验、爱好项目
- 学术机构、教育用途
- 非营利组织、公共研究机构
- 政府机构、公益组织

### ❌ 需要商业授权的场景

- 营利性公司内部生产环境使用
- 将本软件作为付费产品 / SaaS / PaaS 服务对外提供
- 销售、再许可或捆绑销售本软件
- 公司员工在职务范围内使用

### 📧 商业授权咨询

如需商业授权，请联系：**<liuguolin2008@gmail.com>**

请在邮件中说明公司名称、使用场景、规模与所在区域，我们会在 5 个工作日内回复授权条款与报价。
