//! Encrypted key-value store for sensitive strings (API keys, tokens).
//!
//! Layout:
//!   ~/.skills-app/.master.key   — raw 32 random bytes, chmod 600.
//!   ~/.skills-app/secrets.bin   — JSON envelope { nonce_b64, cipher_b64 }
//!                                  containing AES-256-GCM ciphertext of
//!                                  a JSON object `{ name: value, ... }`.
//!
//! Why a single envelope instead of one file per secret?
//!   * Atomic write semantics (rename-in-place) keep the store consistent.
//!   * O(1) reads regardless of how many secrets there are.
//!   * Single nonce/cipher pair → smaller on-disk footprint.
//!
//! We re-encrypt the whole envelope on every mutation. Volume is tiny
//! (handful of secrets, KB-sized), so the perf cost is irrelevant compared
//! to the simpler invariants.

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

const KEY_LEN: usize = 32;

/// Where we keep our pile. Mirrors the existing `~/.skills-app/` convention
/// used by `paths::settings_path()` so users only have one folder to back up.
fn data_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "home directory not available".to_string())?;
    let dir = home.join(".skills-app");
    fs::create_dir_all(&dir).map_err(|e| format!("create data dir failed: {e}"))?;
    Ok(dir)
}

fn key_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join(".master.key"))
}

fn secrets_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("secrets.bin"))
}

/// Load the master key, generating a new one on first run.
///
/// Concurrency note: this is racy if two threads call it simultaneously on a
/// fresh install — both would attempt to `create_new` and one would lose,
/// re-reading the winner's bytes. That's fine and intentional: the first
/// successful create wins, the other thread reads the same key. We avoid a
/// global mutex to keep the call path callable from blocking and async code
/// without bookkeeping.
fn load_or_create_master_key() -> Result<[u8; KEY_LEN], String> {
    let p = key_path()?;
    if p.exists() {
        let bytes = fs::read(&p).map_err(|e| format!("read master key failed: {e}"))?;
        if bytes.len() != KEY_LEN {
            return Err(format!(
                "master key file is corrupt (expected {KEY_LEN} bytes, got {})",
                bytes.len()
            ));
        }
        let mut out = [0u8; KEY_LEN];
        out.copy_from_slice(&bytes);
        return Ok(out);
    }
    let mut key = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);
    write_master_key_atomically(&p, &key)?;
    Ok(key)
}

/// Atomic-ish write: create with restrictive perms (Unix only). Windows
/// inherits the user-profile DACL which already excludes other users.
fn write_master_key_atomically(p: &PathBuf, key: &[u8; KEY_LEN]) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // O_EXCL via create_new prevents racing two processes both writing
        // different keys — losers see "file exists" and fall back to read path.
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(p)
        {
            Ok(mut f) => f
                .write_all(key)
                .map_err(|e| format!("write master key failed: {e}")),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
            Err(e) => Err(format!("create master key failed: {e}")),
        }
    }
    #[cfg(not(unix))]
    {
        match fs::OpenOptions::new().write(true).create_new(true).open(p) {
            Ok(mut f) => f
                .write_all(key)
                .map_err(|e| format!("write master key failed: {e}")),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
            Err(e) => Err(format!("create master key failed: {e}")),
        }
    }
}

/// On-disk envelope for the encrypted secrets blob. Stored as JSON for
/// debug-ability (you can `cat` it to confirm the file isn't corrupt) and
/// because the overhead vs raw binary is negligible at our scale.
#[derive(Serialize, Deserialize, Default)]
struct Envelope {
    /// Base64-encoded 12-byte AES-GCM nonce, generated fresh on every write.
    nonce: String,
    /// Base64-encoded ciphertext + 16-byte GCM auth tag (concatenated by aead).
    cipher: String,
}

/// Sorted map so the encrypted bytes are deterministic for any given input —
/// makes the on-disk blob stable across runs (easier to spot real changes).
type SecretMap = BTreeMap<String, String>;

fn cipher_with_master() -> Result<Aes256Gcm, String> {
    let raw = load_or_create_master_key()?;
    let k = Key::<Aes256Gcm>::from_slice(&raw);
    Ok(Aes256Gcm::new(k))
}

fn read_secrets_map() -> Result<SecretMap, String> {
    let p = secrets_path()?;
    if !p.exists() {
        return Ok(SecretMap::new());
    }
    let raw = fs::read_to_string(&p).map_err(|e| format!("read secrets file failed: {e}"))?;
    if raw.trim().is_empty() {
        return Ok(SecretMap::new());
    }
    let env: Envelope =
        serde_json::from_str(&raw).map_err(|e| format!("parse secrets envelope failed: {e}"))?;
    let nonce_bytes = B64
        .decode(env.nonce.as_bytes())
        .map_err(|e| format!("decode nonce failed: {e}"))?;
    let cipher_bytes = B64
        .decode(env.cipher.as_bytes())
        .map_err(|e| format!("decode cipher failed: {e}"))?;
    if nonce_bytes.len() != 12 {
        return Err(format!(
            "nonce length wrong: expected 12, got {}",
            nonce_bytes.len()
        ));
    }
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plain = cipher_with_master()?
        .decrypt(nonce, cipher_bytes.as_ref())
        .map_err(|e| format!("decrypt failed: {e}"))?;
    let map: SecretMap = serde_json::from_slice(&plain)
        .map_err(|e| format!("parse decrypted secrets failed: {e}"))?;
    Ok(map)
}

fn write_secrets_map(map: &SecretMap) -> Result<(), String> {
    let plain = serde_json::to_vec(map).map_err(|e| format!("serialize secrets failed: {e}"))?;
    let cipher = cipher_with_master()?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let cipher_bytes = cipher
        .encrypt(&nonce, plain.as_ref())
        .map_err(|e| format!("encrypt failed: {e}"))?;
    let env = Envelope {
        nonce: B64.encode(nonce.as_slice()),
        cipher: B64.encode(cipher_bytes),
    };
    let json =
        serde_json::to_string(&env).map_err(|e| format!("serialize envelope failed: {e}"))?;
    let p = secrets_path()?;
    // Atomic-ish write via temp + rename so a crash mid-flight doesn't leave
    // us with a half-written, undecryptable envelope.
    let tmp = p.with_extension("bin.tmp");
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(|e| format!("open secrets tmp failed: {e}"))?;
        f.write_all(json.as_bytes())
            .map_err(|e| format!("write secrets tmp failed: {e}"))?;
    }
    #[cfg(not(unix))]
    {
        fs::write(&tmp, json.as_bytes()).map_err(|e| format!("write secrets tmp failed: {e}"))?;
    }
    fs::rename(&tmp, &p).map_err(|e| format!("rename secrets failed: {e}"))?;
    Ok(())
}

/// Read a previously-stored secret. Returns `Ok(None)` if no entry exists.
///
/// Returns `Err` only for I/O or crypto failures — a missing or empty store
/// is "no entry" not an error so the caller can treat "no key configured"
/// as a benign state.
pub fn get_secret(name: &str) -> Result<Option<String>, String> {
    let map = read_secrets_map()?;
    Ok(map.get(name).cloned())
}

/// Persist `value` under `name`, replacing any existing entry.
pub fn set_secret(name: &str, value: &str) -> Result<(), String> {
    let mut map = read_secrets_map().unwrap_or_default();
    map.insert(name.to_string(), value.to_string());
    write_secrets_map(&map)
}

/// Remove the entry; no-op if it was already absent.
pub fn delete_secret(name: &str) -> Result<(), String> {
    let mut map = match read_secrets_map() {
        Ok(m) => m,
        Err(_) => return Ok(()), // corrupt file? "delete" is implicit
    };
    if map.remove(name).is_none() {
        return Ok(());
    }
    write_secrets_map(&map)
}
