//! Cross-platform, zero-popup secret storage.
//!
//! We were using the OS keyring (Keychain on macOS, libsecret on Linux,
//! Credential Manager on Windows) which is the gold-standard option but
//! constantly prompts the user for permission — especially during dev when
//! the binary signature changes after every `cargo run`. That UX is so bad
//! it was the #1 complaint about AI features in this app.
//!
//! Trade-off chosen: drop the keyring entirely and replace it with a small
//! AES-256-GCM envelope encrypted by a 256-bit master key that lives next
//! to `settings.json` (`~/.skills-app/.master.key`, chmod 600 on Unix).
//!
//! Security posture:
//!  * `secrets.bin` on disk is encrypted; can't be `cat`'d.
//!  * Anyone with read-access to the user's home dir can read both the
//!    cipher and the key → effectively the same threat model as SSH
//!    private keys or browser cookies. We deliberately accept this for
//!    a *better than plaintext, dramatically better than keyring UX* combo.
//!  * If the user backs up `~/.skills-app/` (key + secrets together) the
//!    setup migrates cleanly. Bringing only `secrets.bin` without the
//!    `.master.key` results in a clean "API key not configured" state,
//!    which is the safe default.
//!
//! Public surface intentionally mirrors the keyring API we replaced so the
//! callers (commands/ai.rs) only need a one-line change.

pub mod secrets;

pub use secrets::{delete_secret, get_secret, set_secret};
