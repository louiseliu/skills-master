use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillRepo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub repo_url: String,
    pub local_path: String,
    pub last_synced: Option<String>,
    pub skill_count: usize,
}
