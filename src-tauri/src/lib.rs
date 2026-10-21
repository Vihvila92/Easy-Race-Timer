//! Minimal Tauri shell for Easy Race Timer.
//!
//! The shell only hosts the bundled web UI. It registers no custom commands
//! and no plugins. The updater plugin is added in #136; the Node server sidecar
//! (ADR 0010) is a follow-up. `plugins.updater.pubkey` is a placeholder until
//! the release key pair exists. See `docs/release.md`.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Easy Race Timer");
}
