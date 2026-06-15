pub mod cache;
pub mod clawhub;
pub mod skillhub;
pub mod skillssh;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MarketplaceSkill {
    pub name: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub repository: Option<String>,
    pub installs: Option<u64>,
    pub source: String,
}

/// 聚合 skills.sh / SkillHub / ClawHub 三家搜索结果。
/// 单家失败时静默跳过，不影响其他家结果。
pub fn search_combined(query: &str) -> Vec<MarketplaceSkill> {
    let mut combined: Vec<MarketplaceSkill> = Vec::new();
    if let Ok(items) = skillssh::search_skillssh(query) {
        combined.extend(items);
    }
    if let Ok(items) = skillhub::search_skillhub(query) {
        combined.extend(items);
    }
    if let Ok(items) = clawhub::search_clawhub(query) {
        combined.extend(items);
    }

    // 去重：同名 + 同 repository 视为重复，保留 installs 最高的那条
    combined.sort_by(|a, b| b.installs.unwrap_or(0).cmp(&a.installs.unwrap_or(0)));
    let mut seen = std::collections::HashSet::new();
    combined.retain(|s| {
        let key = format!(
            "{}|{}",
            s.name.to_lowercase(),
            s.repository.as_deref().unwrap_or("").to_lowercase()
        );
        seen.insert(key)
    });

    combined
}
