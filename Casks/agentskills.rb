cask "agentskills" do
  version "0.1.0"
  sha256 arm:   "67a4155c45a94e0f8ff5bba9d138affceb092d5ebaabcb842391d0bd4cb4aaf2"
  sha256 intel: "baecacb87ce5b615b6289b8b2771e11ba219903a116ba07c970ee99bcf1c54fa"

  on_arm do
    url "https://github.com/chrlsio/agent-skills/releases/download/v#{version}/AgentSkills_#{version}_aarch64.dmg"
  end

  on_intel do
    url "https://github.com/chrlsio/agent-skills/releases/download/v#{version}/AgentSkills_#{version}_x64.dmg"
  end

  name "AgentSkills"
  desc "Cross-platform desktop app for managing AI agent skills"
  homepage "https://github.com/chrlsio/agent-skills"

  app "AgentSkills.app"

  zap trash: [
    "~/Library/Application Support/com.agentskills.app",
    "~/Library/Preferences/com.agentskills.app.plist"
  ]
end
