use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use thiserror::Error;

use crate::models::agent::{AgentConfig, SkillFormat};
use crate::models::skill::{Skill, SkillInstallation, SkillScope, SkillSource};
use crate::parser::skillmd::parse_skill_md_file;

#[derive(Debug, Error)]
pub enum ScannerError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("parse error: {0}")]
    Parse(String),
}

/// Resolve a path through symlink chains to its final real path.
/// Equivalent to Swift's `resolvingSymlinksInPath()`.
fn resolve_canonical(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Check if a path is a symlink (without following it).
fn is_symlink(path: &Path) -> bool {
    path.symlink_metadata()
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

/// Scan all skills across all agents, returning deduplicated results.
///
/// Dedup key: directory name (skill id), matching Swift SkillScanner.
///
/// Strategy:
/// 1. Scan each agent's skill directories
/// 2. Resolve symlinks to get canonical path
/// 3. Merge by directory name — same name = same skill
/// 4. Track per-agent installations with symlink/inherited metadata
/// 5. Upgrade scope to SharedGlobal if installed in >1 agent
pub fn scan_all_skills(configs: &[AgentConfig]) -> Result<Vec<Skill>, ScannerError> {
    let mut dedup: HashMap<String, Skill> = HashMap::new();

    for agent in configs.iter().filter(|cfg| cfg.detected || !cfg.global_paths.is_empty()) {
        for root in &agent.global_paths {
            let root_path = PathBuf::from(root);
            if !root_path.exists() {
                continue;
            }
            match agent.skill_format {
                SkillFormat::SkillMd => {
                    scan_skill_md_root(&root_path, agent, &mut dedup)?;
                }
                SkillFormat::GeminiExtension => {
                    scan_gemini_root(&root_path, agent, &mut dedup)?;
                }
            }
        }
    }

    let mut items: Vec<Skill> = dedup.into_values().collect();
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(items)
}

fn scan_skill_md_root(
    root: &Path,
    agent: &AgentConfig,
    dedup: &mut HashMap<String, Skill>,
) -> Result<(), ScannerError> {
    for dir in fs::read_dir(root)? {
        let dir = dir?;
        let skill_dir = dir.path();
        if !skill_dir.is_dir() && !is_symlink(&skill_dir) {
            continue;
        }

        // Resolve symlinks to canonical path
        let canonical = resolve_canonical(&skill_dir);
        let skill_md = canonical.join("SKILL.md");
        if !skill_md.is_file() {
            continue;
        }

        let parsed = match parse_skill_md_file(&skill_md) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("skipping {}: {e}", skill_md.display());
                continue;
            }
        };

        // Dedup key = directory name
        let dir_name = skill_dir
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or("unknown-skill")
            .to_string();

        let skill_name = parsed.name.clone().unwrap_or_else(|| dir_name.clone());
        let symlink = is_symlink(&skill_dir);

        let installation = SkillInstallation {
            agent_slug: agent.slug.clone(),
            path: skill_dir.to_string_lossy().to_string(),
            is_symlink: symlink,
            is_inherited: false,
            inherited_from: None,
        };

        merge_skill(
            dedup,
            dir_name,
            Skill {
                id: skill_dir
                    .file_name()
                    .and_then(|f| f.to_str())
                    .unwrap_or("unknown-skill")
                    .to_string(),
                name: skill_name,
                description: parsed.description,
                canonical_path: canonical.to_string_lossy().to_string(),
                source: Some(SkillSource::LocalPath {
                    path: canonical.to_string_lossy().to_string(),
                }),
                metadata: parsed.metadata,
                scope: SkillScope::AgentLocal {
                    agent: agent.slug.clone(),
                },
                installations: vec![installation],
            },
        );
    }
    Ok(())
}

fn scan_gemini_root(
    root: &Path,
    agent: &AgentConfig,
    dedup: &mut HashMap<String, Skill>,
) -> Result<(), ScannerError> {
    for dir in fs::read_dir(root)? {
        let dir = dir?;
        let skill_dir = dir.path();
        if !skill_dir.is_dir() && !is_symlink(&skill_dir) {
            continue;
        }

        let canonical = resolve_canonical(&skill_dir);
        let ext_file = canonical.join("gemini-extension.json");
        if !ext_file.is_file() {
            continue;
        }

        let content = fs::read_to_string(&ext_file)?;
        let json: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| ScannerError::Parse(e.to_string()))?;

        let dir_name = skill_dir
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or("gemini-extension")
            .to_string();

        let name = json
            .get("name")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| dir_name.clone());

        let description = json
            .get("description")
            .and_then(|v| v.as_str())
            .map(str::to_string);

        let symlink = is_symlink(&skill_dir);

        let installation = SkillInstallation {
            agent_slug: agent.slug.clone(),
            path: skill_dir.to_string_lossy().to_string(),
            is_symlink: symlink,
            is_inherited: false,
            inherited_from: None,
        };

        merge_skill(
            dedup,
            dir_name,
            Skill {
                id: skill_dir
                    .file_name()
                    .and_then(|f| f.to_str())
                    .unwrap_or("gemini-extension")
                    .to_string(),
                name,
                description,
                canonical_path: canonical.to_string_lossy().to_string(),
                source: Some(SkillSource::LocalPath {
                    path: canonical.to_string_lossy().to_string(),
                }),
                metadata: Some(json),
                scope: SkillScope::AgentLocal {
                    agent: agent.slug.clone(),
                },
                installations: vec![installation],
            },
        );
    }
    Ok(())
}

/// Merge an incoming skill into the dedup map.
///
/// If a skill with the same key already exists:
/// - Append new installations (skip duplicates by agent_slug)
/// - Upgrade scope to SharedGlobal if now installed in >1 agent
fn merge_skill(dedup: &mut HashMap<String, Skill>, key: String, incoming: Skill) {
    if let Some(existing) = dedup.get_mut(&key) {
        for inst in incoming.installations {
            let dominated = existing
                .installations
                .iter()
                .any(|e| e.agent_slug == inst.agent_slug);
            if !dominated {
                existing.installations.push(inst);
            }
        }
        // Scope upgrade: if >1 distinct non-inherited agent, upgrade to SharedGlobal
        let distinct_agents: std::collections::HashSet<&str> = existing
            .installations
            .iter()
            .filter(|i| !i.is_inherited)
            .map(|i| i.agent_slug.as_str())
            .collect();
        if distinct_agents.len() > 1 {
            existing.scope = SkillScope::SharedGlobal;
        }
        return;
    }
    dedup.insert(key, incoming);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::agent::AgentConfig;

    fn test_dir(name: &str) -> PathBuf {
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock drift")
            .as_millis();
        let dir = std::env::temp_dir().join(format!("skills-app-scanner-{name}-{millis}"));
        fs::create_dir_all(&dir).expect("create temp test dir");
        dir
    }

    #[test]
    fn dedup_same_skill_in_multiple_agents() {
        let root = test_dir("dedup");
        let shared_skill_dir = root.join("skill-a");
        fs::create_dir_all(&shared_skill_dir).expect("create skill dir");
        fs::write(
            shared_skill_dir.join("SKILL.md"),
            "---\nname: Skill A\ndescription: test\n---\nBody",
        )
        .expect("write skill");

        let cfg1 = AgentConfig {
            slug: "codex".to_string(),
            name: "Codex".to_string(),
            global_paths: vec![root.to_string_lossy().to_string()],
            detected: true,
            ..Default::default()
        };
        let cfg2 = AgentConfig {
            slug: "cursor".to_string(),
            name: "Cursor".to_string(),
            global_paths: vec![root.to_string_lossy().to_string()],
            detected: true,
            ..Default::default()
        };

        let skills = scan_all_skills(&[cfg1, cfg2]).expect("scan");
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].installations.len(), 2);
        assert_eq!(skills[0].scope, SkillScope::SharedGlobal);
    }

    #[test]
    fn scan_gemini_extension() {
        let root = test_dir("gemini");
        let ext_dir = root.join("ext");
        fs::create_dir_all(&ext_dir).expect("create ext dir");
        fs::write(
            ext_dir.join("gemini-extension.json"),
            r#"{"name":"Gem Skill","description":"Gemini extension"}"#,
        )
        .expect("write extension");
        let cfg = AgentConfig {
            slug: "gemini-cli".to_string(),
            name: "Gemini".to_string(),
            global_paths: vec![root.to_string_lossy().to_string()],
            skill_format: SkillFormat::GeminiExtension,
            detected: true,
            ..Default::default()
        };
        let skills = scan_all_skills(&[cfg]).expect("scan");
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "Gem Skill");
    }

    #[test]
    fn symlink_resolved_and_merged() {
        let root1 = test_dir("sym-agent1");
        let root2 = test_dir("sym-agent2");
        let canonical_dir = test_dir("sym-canonical");

        // Create canonical skill
        let skill_canon = canonical_dir.join("my-skill");
        fs::create_dir_all(&skill_canon).expect("create canonical skill");
        fs::write(
            skill_canon.join("SKILL.md"),
            "---\nname: My Skill\n---\nBody",
        )
        .expect("write skill");

        // Create symlink in agent1 dir
        let link1 = root1.join("my-skill");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&skill_canon, &link1).expect("create symlink");

        // Create symlink in agent2 dir
        let link2 = root2.join("my-skill");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&skill_canon, &link2).expect("create symlink");

        let cfg1 = AgentConfig {
            slug: "agent-a".to_string(),
            name: "Agent A".to_string(),
            global_paths: vec![root1.to_string_lossy().to_string()],
            detected: true,
            ..Default::default()
        };
        let cfg2 = AgentConfig {
            slug: "agent-b".to_string(),
            name: "Agent B".to_string(),
            global_paths: vec![root2.to_string_lossy().to_string()],
            detected: true,
            ..Default::default()
        };

        let skills = scan_all_skills(&[cfg1, cfg2]).expect("scan");
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].installations.len(), 2);
        assert!(skills[0].installations.iter().all(|i| i.is_symlink));
        assert_eq!(skills[0].scope, SkillScope::SharedGlobal);
    }
}
