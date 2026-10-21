// SPDX-License-Identifier: AGPL-3.0-only
//! Minimal Tauri shell for Easy Race Timer.
//!
//! The shell only hosts the bundled web UI. It registers no custom commands
//! and no plugins. The updater is added in #136; the Node server sidecar
//! (ADR 0010) is a follow-up.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Easy Race Timer");
}
