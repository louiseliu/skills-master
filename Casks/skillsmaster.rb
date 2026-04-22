cask "skillsmaster" do
  version "0.9.0"
  arch arm: "aarch64", intel: "x64"
  sha256 :no_check

  url "https://github.com/louiseliu/skills-master/releases/download/v#{version}/SkillsMaster_#{version}_#{arch}.dmg"

  name "SkillsMaster"
  desc "技能管家 — 跨平台桌面应用，统一管理 36 款 AI Agent 的技能"
  homepage "https://github.com/louiseliu/skills-master"

  app "SkillsMaster.app"

  zap trash: [
    "~/Library/Application Support/com.skillsmaster.app",
    "~/Library/Caches/com.skillsmaster.app",
    "~/Library/Preferences/com.skillsmaster.app.plist",
    "~/Library/Saved Application State/com.skillsmaster.app.savedState"
  ]

  caveats <<~EOS
    If you encounter the "App is damaged" error, run:
      sudo xattr -rd com.apple.quarantine "/Applications/SkillsMaster.app"

    Or install with:
      brew install --cask --no-quarantine skillsmaster
  EOS
end
