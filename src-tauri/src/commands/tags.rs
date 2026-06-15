use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::parser::skillmd::{dedup_tags, normalize_tag};

/// On-disk shape of the user tag override file.
/// Key = skill id (directory name).
/// Value = normalized tag list. Absence means "use frontmatter default".
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TagOverrideStore {
    #[serde(default)]
    pub skills: HashMap<String, Vec<String>>,
}

fn overrides_path() -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        return home.join(".skills-app").join("skill-tags.json");
    }
    PathBuf::from(".skills-app/skill-tags.json")
}

/// Module-level lock to serialize concurrent writes from multiple Tauri commands.
fn store_lock() -> &'static Mutex<()> {
    use std::sync::OnceLock;
    static L: OnceLock<Mutex<()>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(()))
}

fn read_store() -> Result<TagOverrideStore, String> {
    let path = overrides_path();
    if !path.exists() {
        return Ok(TagOverrideStore::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read tag overrides: {e}"))?;
    if raw.trim().is_empty() {
        return Ok(TagOverrideStore::default());
    }
    serde_json::from_str(&raw).map_err(|e| format!("parse tag overrides: {e}"))
}

fn write_store(store: &TagOverrideStore) -> Result<(), String> {
    let path = overrides_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir tag overrides: {e}"))?;
    }
    let json = serde_json::to_string_pretty(store)
        .map_err(|e| format!("serialize tag overrides: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("write tag overrides: {e}"))
}

/// Normalize an incoming tag list (lowercase, trim, strip `#`, dedup, drop empties).
fn sanitize(tags: Vec<String>) -> Vec<String> {
    let mut out = Vec::with_capacity(tags.len());
    for t in tags {
        if let Some(n) = normalize_tag(&t) {
            out.push(n);
        }
    }
    dedup_tags(out)
}

// ============================================================
//  Public helpers (used by scanner)
// ============================================================

/// Returns the full override map. If the file is missing or malformed,
/// returns an empty map (degrades gracefully — scanner should never crash
/// because of a bad user file).
pub fn load_overrides_or_empty() -> HashMap<String, Vec<String>> {
    read_store().map(|s| s.skills).unwrap_or_default()
}

// ============================================================
//  Tauri commands
// ============================================================

/// Returns the raw override map (empty if no overrides set).
#[tauri::command]
pub fn list_skill_tag_overrides() -> Result<HashMap<String, Vec<String>>, String> {
    let _g = store_lock().lock().map_err(|e| e.to_string())?;
    let store = read_store()?;
    Ok(store.skills)
}

/// Set / replace the tag override for one skill. Pass an empty list to
/// clear (we delete the entry so the skill falls back to frontmatter tags).
#[tauri::command]
pub fn set_skill_tags(skill_id: String, tags: Vec<String>) -> Result<Vec<String>, String> {
    let _g = store_lock().lock().map_err(|e| e.to_string())?;
    let mut store = read_store().unwrap_or_default();
    let cleaned = sanitize(tags);
    if cleaned.is_empty() {
        store.skills.remove(&skill_id);
    } else {
        store.skills.insert(skill_id, cleaned.clone());
    }
    write_store(&store)?;
    Ok(cleaned)
}

/// Append one tag to a skill's override. If the skill currently has no
/// override, we seed from the provided `current_default` (i.e. frontmatter
/// tags) so the user's add is additive, not destructive.
#[tauri::command]
pub fn add_skill_tag(
    skill_id: String,
    tag: String,
    current_default: Vec<String>,
) -> Result<Vec<String>, String> {
    let _g = store_lock().lock().map_err(|e| e.to_string())?;
    let mut store = read_store().unwrap_or_default();
    let mut effective: Vec<String> = store
        .skills
        .get(&skill_id)
        .cloned()
        .unwrap_or_else(|| sanitize(current_default));
    if let Some(n) = normalize_tag(&tag) {
        effective.push(n);
    }
    let final_tags = dedup_tags(effective);
    if final_tags.is_empty() {
        store.skills.remove(&skill_id);
    } else {
        store.skills.insert(skill_id, final_tags.clone());
    }
    write_store(&store)?;
    Ok(final_tags)
}

/// Remove one tag from a skill's override. Same seeding rule as add.
#[tauri::command]
pub fn remove_skill_tag(
    skill_id: String,
    tag: String,
    current_default: Vec<String>,
) -> Result<Vec<String>, String> {
    let _g = store_lock().lock().map_err(|e| e.to_string())?;
    let mut store = read_store().unwrap_or_default();
    let normalized = normalize_tag(&tag);
    let mut effective: Vec<String> = store
        .skills
        .get(&skill_id)
        .cloned()
        .unwrap_or_else(|| sanitize(current_default));
    if let Some(n) = normalized {
        effective.retain(|x| x != &n);
    }
    if effective.is_empty() {
        store.skills.remove(&skill_id);
    } else {
        store.skills.insert(skill_id, effective.clone());
    }
    write_store(&store)?;
    Ok(effective)
}

/// Completely clear the override for a skill (revert to frontmatter default).
#[tauri::command]
pub fn clear_skill_tag_override(skill_id: String) -> Result<(), String> {
    let _g = store_lock().lock().map_err(|e| e.to_string())?;
    let mut store = read_store().unwrap_or_default();
    store.skills.remove(&skill_id);
    write_store(&store)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_lowercases_and_dedups() {
        let r = sanitize(vec![
            " #AI 编程 ".into(),
            "ai 编程".into(),
            "Database".into(),
            "  ".into(),
        ]);
        assert_eq!(r.len(), 2);
        assert!(r.contains(&"ai 编程".to_string()));
        assert!(r.contains(&"database".to_string()));
    }
}
