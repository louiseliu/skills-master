use std::fs;
use std::path::{Path, PathBuf};

use thiserror::Error;

use crate::models::agent::AgentConfig;

#[derive(Debug, Error)]
pub enum UninstallError {
    #[error("agent `{0}` not found")]
    AgentNotFound(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

pub fn uninstall_skill(
    skill_dir: &Path,
    agent_slug: &str,
    agents: &[AgentConfig],
) -> Result<(), UninstallError> {
    let agent = agents
        .iter()
        .find(|a| a.slug == agent_slug)
        .ok_or_else(|| UninstallError::AgentNotFound(agent_slug.to_string()))?;

    if skill_dir.exists() {
        fs::remove_dir_all(skill_dir)?;
    }

    if let Some(cfgs) = &agent.extra_config {
        for cfg in cfgs {
            if let Some(target_file) = &cfg.target_file {
                let path = expand_home_path(target_file);
                if path.is_file() {
                    let _ = fs::remove_file(path);
                }
            }
        }
    }

    // Best-effort registry cleanup for known agents.
    if agent_slug == "cursor" {
        let _ = cleanup_registry_entry(
            &expand_home_path("~/.cursor/manifest.json"),
            skill_dir.to_string_lossy().as_ref(),
        );
    }
    if agent_slug == "openclaw" {
        let _ = cleanup_registry_entry(
            &expand_home_path("~/.openclaw/openclaw.json"),
            skill_dir.to_string_lossy().as_ref(),
        );
    }

    Ok(())
}

fn cleanup_registry_entry(registry_path: &Path, skill_path: &str) -> Result<(), UninstallError> {
    if !registry_path.is_file() {
        return Ok(());
    }
    let content = fs::read_to_string(registry_path)?;
    let mut json: serde_json::Value = serde_json::from_str(&content)?;
    if let Some(skills) = json.get_mut("skills").and_then(|v| v.as_array_mut()) {
        skills.retain(|item| {
            item.get("path")
                .and_then(|v| v.as_str())
                .map(|path| path != skill_path)
                .unwrap_or(true)
        });
        fs::write(registry_path, serde_json::to_string_pretty(&json)?)?;
    }
    Ok(())
}

fn expand_home_path(path: &str) -> PathBuf {
    if let Some(stripped) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(stripped);
        }
    }
    PathBuf::from(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "skills-app-uninstall-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock drift")
                .as_millis()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn uninstall_removes_skill_directory() {
        let root = test_dir("remove-dir");
        let skill_dir = root.join("demo-skill");
        fs::create_dir_all(&skill_dir).expect("create skill");
        fs::write(skill_dir.join("SKILL.md"), "demo").expect("write skill file");

        let agent = AgentConfig {
            slug: "codex".into(),
            name: "Codex".into(),
            ..Default::default()
        };
        uninstall_skill(&skill_dir, "codex", &[agent]).expect("uninstall");
        assert!(!skill_dir.exists());
    }

    #[test]
    fn uninstall_removes_registry_entry() {
        let root = test_dir("registry");
        let reg = root.join("manifest.json");
        fs::write(
            &reg,
            r#"{"skills":[{"path":"/tmp/keep"},{"path":"/tmp/remove"}]}"#,
        )
        .expect("write registry");
        cleanup_registry_entry(&reg, "/tmp/remove").expect("cleanup");
        let content = fs::read_to_string(reg).expect("read registry");
        assert!(content.contains("/tmp/keep"));
        assert!(!content.contains("/tmp/remove"));
    }
}
