use std::path::Path;

use tauri::{AppHandle, Emitter};

use crate::installer::install::{
    install_skill_from_git, install_skill_from_git_with_source, install_skill_from_path,
    read_provenance,
};
use crate::installer::uninstall::{
    uninstall_skill as uninstall_skill_impl,
    uninstall_skill_from_all as uninstall_skill_from_all_impl,
};
use crate::installer::update as updater;
use crate::models::agent::AgentConfig;
use crate::models::skill::{Skill, SkillSource, UpdateAllResult};
use crate::paths;
use crate::registry::loader::{detect_agents, load_agent_configs};
use crate::scanner::engine::scan_all_skills as scan_all_skills_impl;

fn load_detected_agents() -> Result<Vec<AgentConfig>, String> {
    let configs = load_agent_configs(&paths::agents_dir()).map_err(|e| e.to_string())?;
    Ok(detect_agents(&configs))
}

#[tauri::command]
pub async fn scan_all_skills() -> Result<Vec<Skill>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let agents = load_detected_agents()?;
        scan_all_skills_impl(&agents).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn scan_agent_skills(agent_slug: String) -> Result<Vec<Skill>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agents = load_detected_agents()?;
        let all = scan_all_skills_impl(&agents).map_err(|e| e.to_string())?;
        Ok(all
            .into_iter()
            .filter(|s| s.installations.iter().any(|i| i.agent_slug == agent_slug))
            .collect())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn install_skill(source: SkillSource, target_agents: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agents = load_detected_agents()?;
        match source {
            SkillSource::LocalPath { path } => {
                let source_path = Path::new(&path).to_path_buf();
                install_skill_from_path(&source_path, &target_agents, &agents)
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            SkillSource::GitRepository {
                repo_url,
                skill_path,
            } => {
                let relative = skill_path.unwrap_or_else(|| ".".to_string());
                install_skill_from_git(&repo_url, &relative, &target_agents, &agents)
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            SkillSource::SkillsSh { repository } => {
                let repo = repository.ok_or_else(|| "repository url is required".to_string())?;
                install_skill_from_git_with_source(&repo, ".", &target_agents, &agents, "skills.sh")
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            SkillSource::ClawHub { repository } => {
                let repo = repository.ok_or_else(|| "repository url is required".to_string())?;
                install_skill_from_git_with_source(&repo, ".", &target_agents, &agents, "clawhub")
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            SkillSource::SkillHub { repository } => {
                let repo = repository.ok_or_else(|| "repository url is required".to_string())?;
                install_skill_from_git_with_source(&repo, ".", &target_agents, &agents, "skillhub")
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            SkillSource::Unknown => Err("unsupported skill source".to_string()),
        }
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn uninstall_skill(skill_id: String, agent_slug: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agents = load_detected_agents()?;
        uninstall_skill_impl(&skill_id, &agent_slug, &agents).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn uninstall_skill_all(skill_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agents = load_detected_agents()?;
        uninstall_skill_from_all_impl(&skill_id, &agents).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn sync_skill(skill_id: String, target_agents: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agents = load_detected_agents()?;
        let source = resolve_skill_source(&skill_id, &agents)?;
        install_skill_from_path(&source, &target_agents, &agents).map_err(|e| e.to_string())?;
        // Preserve provenance: install_skill_from_path copies to canonical but does not
        // touch the provenance registry, so any existing provenance entry for this
        // skill_id is automatically retained. If the skill was only in an agent dir
        // (not canonical) and had no provenance, there is nothing to preserve.
        Ok(())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

/// Update a single skill from its upstream git repository.
#[tauri::command]
pub async fn update_skill(skill_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agents = load_detected_agents()?;
        let provenance = read_provenance();
        let entry = provenance
            .get(&skill_id)
            .ok_or_else(|| format!("No provenance for skill '{skill_id}'"))?;

        let source_label = entry.get("source").and_then(|v| v.as_str()).unwrap_or("");
        let repo_url = entry
            .get("repository")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| format!("Skill '{skill_id}' has no repository URL"))?;
        let skill_path = entry.get("skill_path").and_then(|v| v.as_str());

        let all_skills = scan_all_skills_impl(&agents).map_err(|e| e.to_string())?;
        let target_agents: Vec<String> = all_skills
            .iter()
            .find(|s| s.id == skill_id)
            .map(|s| s.all_agents())
            .unwrap_or_default();

        let session = updater::RepoSession::open(repo_url).map_err(|e| e.to_string())?;
        updater::update_skill(
            &skill_id,
            source_label,
            repo_url,
            skill_path,
            &target_agents,
            &agents,
            &session,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

/// Update all skills that have an upstream git repository.
#[tauri::command]
pub async fn update_all_skills(app: AppHandle) -> Result<UpdateAllResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agents = load_detected_agents()?;
        Ok(updater::update_all(&agents, |progress| {
            let _ = app.emit("skill-update-progress", &progress);
        }))
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

/// Find the actual source directory for a skill by id.
/// Checks canonical location first, then falls back to agent directories.
fn resolve_skill_source(
    skill_id: &str,
    agents: &[AgentConfig],
) -> Result<std::path::PathBuf, String> {
    // 1. Check canonical ~/.agents/skills/<id>/
    let canonical = crate::installer::install::shared_skills_dir().join(skill_id);
    if canonical.is_dir() {
        return Ok(canonical);
    }
    // 2. Fall back: search agent directories
    for agent in agents {
        for root in &agent.global_paths {
            let agent_skill = std::path::PathBuf::from(root).join(skill_id);
            if agent_skill.is_dir() {
                return Ok(agent_skill);
            }
        }
    }
    Err(format!("skill '{}' not found in any directory", skill_id))
}

#[tauri::command]
pub async fn read_skill_content(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let normalized: std::path::PathBuf = path.replace('/', std::path::MAIN_SEPARATOR_STR).into();
        std::fs::read_to_string(&normalized).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn write_skill_content(path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let normalized: std::path::PathBuf = path.replace('/', std::path::MAIN_SEPARATOR_STR).into();
        std::fs::write(&normalized, content).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn install_from_git(
    repo_url: String,
    skill_relative_path: String,
    target_agents: Vec<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agents = load_detected_agents()?;
        install_skill_from_git(&repo_url, &skill_relative_path, &target_agents, &agents)
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

/// Build candidate raw-file URLs for a skill across well-known Git hosts.
///
/// Different hosts use different raw-file URL templates:
/// - GitHub:     `raw.githubusercontent.com/{user}/{repo}/{branch}/{path}`
/// - Gitee:      `gitee.com/{user}/{repo}/raw/{branch}/{path}`
/// - GitLab:     `{host}/{user}/{repo}/-/raw/{branch}/{path}`  (works for self-hosted GitLab too)
/// - Bitbucket:  `bitbucket.org/{user}/{repo}/raw/{branch}/{path}`
/// - Unknown:    fall back to GitLab-style (most permissive for self-hosted)
fn build_raw_candidate_urls(repo_url: &str, file_path: &str, branch: &str) -> Vec<String> {
    let repo = repo_url.trim_end_matches('/').trim_end_matches(".git");

    // Strip the scheme so we can split host vs path
    let without_scheme = repo
        .strip_prefix("https://")
        .or_else(|| repo.strip_prefix("http://"))
        .unwrap_or(repo);

    let (host, path_part) = match without_scheme.split_once('/') {
        Some((h, p)) => (h.to_lowercase(), p),
        None => return Vec::new(),
    };

    let mut out = Vec::new();
    if host == "github.com" {
        // Primary: raw.githubusercontent.com
        out.push(format!(
            "https://raw.githubusercontent.com/{path_part}/{branch}/{file_path}"
        ));
    } else if host == "gitee.com" {
        out.push(format!(
            "https://gitee.com/{path_part}/raw/{branch}/{file_path}"
        ));
    } else if host == "bitbucket.org" {
        out.push(format!(
            "https://bitbucket.org/{path_part}/raw/{branch}/{file_path}"
        ));
    } else {
        // GitLab.com or any self-hosted GitLab — also a sensible fallback for unknown hosts
        out.push(format!(
            "https://{host}/{path_part}/-/raw/{branch}/{file_path}"
        ));
        // Some self-hosted services use the simpler `/raw/` style; try as a backup
        out.push(format!(
            "https://{host}/{path_part}/raw/{branch}/{file_path}"
        ));
    }
    out
}

/// Fetch SKILL.md from a hosted Git repository.
///
/// Supports GitHub, Gitee, GitLab (incl. self-hosted), Bitbucket, and falls back
/// gracefully for unknown hosts. When `skill_name` is provided, tries
/// `skills/{skill_name}/SKILL.md` first (skills.sh mono-repo convention),
/// then root `SKILL.md`.
#[tauri::command]
pub async fn fetch_remote_skill_content(
    repo_url: String,
    skill_name: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = crate::network::build_blocking_client_with_timeout(
            "SkillsMaster/1.0",
            std::time::Duration::from_secs(10),
        )
        .map_err(|e| e.to_string())?;

        let branches = ["main", "master"];

        let mut file_paths: Vec<String> = Vec::new();
        if let Some(ref name) = skill_name {
            file_paths.push(format!("skills/{name}/SKILL.md"));
        }
        file_paths.push("SKILL.md".to_string());

        for path in &file_paths {
            for branch in &branches {
                for raw_url in build_raw_candidate_urls(&repo_url, path, branch) {
                    // GitHub-targeted URLs benefit from the proxy; non-GitHub URLs are passed through unchanged
                    let url = crate::network::accelerate_github_url(&raw_url);
                    match client.get(&url).send() {
                        Ok(resp) if resp.status().is_success() => {
                            if let Ok(text) = resp.text() {
                                if !text.is_empty() {
                                    return Ok(text);
                                }
                            }
                        }
                        _ => continue,
                    }
                }
            }
        }

        Err("Could not fetch SKILL.md from repository".to_string())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[cfg(test)]
mod fetch_remote_tests {
    use super::build_raw_candidate_urls;

    #[test]
    fn github_uses_raw_githubusercontent() {
        let urls = build_raw_candidate_urls("https://github.com/user/repo.git", "SKILL.md", "main");
        assert_eq!(
            urls,
            vec!["https://raw.githubusercontent.com/user/repo/main/SKILL.md".to_string()]
        );
    }

    #[test]
    fn gitee_uses_raw_under_gitee() {
        let urls = build_raw_candidate_urls("https://gitee.com/user/repo", "SKILL.md", "master");
        assert_eq!(
            urls,
            vec!["https://gitee.com/user/repo/raw/master/SKILL.md".to_string()]
        );
    }

    #[test]
    fn gitlab_uses_dash_raw_path() {
        let urls = build_raw_candidate_urls(
            "https://gitlab.com/group/repo.git",
            "skills/x/SKILL.md",
            "main",
        );
        assert!(urls.contains(
            &"https://gitlab.com/group/repo/-/raw/main/skills/x/SKILL.md".to_string()
        ));
    }

    #[test]
    fn self_hosted_gitlab_works() {
        let urls = build_raw_candidate_urls(
            "https://git.example.com/team/repo.git",
            "SKILL.md",
            "main",
        );
        assert!(urls.iter().any(|u| u.contains("git.example.com")));
        assert!(urls.iter().any(|u| u.contains("/-/raw/")));
    }

    #[test]
    fn bitbucket_works() {
        let urls =
            build_raw_candidate_urls("https://bitbucket.org/user/repo", "SKILL.md", "main");
        assert_eq!(
            urls,
            vec!["https://bitbucket.org/user/repo/raw/main/SKILL.md".to_string()]
        );
    }
}
