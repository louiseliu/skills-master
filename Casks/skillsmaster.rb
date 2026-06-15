cask "skillsmaster" do
  version "1.0.2"
  arch arm: "aarch64", intel: "x64"
  sha256 :no_check

  url "https://github.com/louiseliu/skills-master/releases/download/v#{version}/%E6%8A%80%E8%83%BD%E7%AE%A1%E5%AE%B6_#{version}_#{arch}.dmg"

  name "技能管家"
  name "SkillsMaster"
  desc "技能管家 — 跨平台桌面应用，统一管理 36 款 AI Agent 的技能"
  homepage "https://github.com/louiseliu/skills-master"

  app "技能管家.app"

  zap trash: [
    "~/Library/Application Support/com.skillsmaster.app",
    "~/Library/Caches/com.skillsmaster.app",
    "~/Library/Preferences/com.skillsmaster.app.plist",
    "~/Library/Saved Application State/com.skillsmaster.app.savedState"
  ]

  caveats <<~EOS
    如果首次启动遇到「无法验证开发者」或「应用已损坏」提示，请运行：
      sudo xattr -rd com.apple.quarantine "/Applications/技能管家.app"

    或在安装时直接绕过隔离：
      brew install --cask --no-quarantine skillsmaster

    If you encounter the "App is damaged" error, run:
      sudo xattr -rd com.apple.quarantine "/Applications/技能管家.app"
  EOS
end
