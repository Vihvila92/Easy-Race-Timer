//! Tauri shell for Easy Race Timer.
//!
//! The shell does not know race rules. It spawns the Node sidecar, waits for
//! one `ERT_READY` line, and opens that loopback URL. On failure it shows the
//! static Finnish and English page bundled as the window's local document.

mod ready;

use std::sync::Mutex;
use std::time::Duration;

use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::mpsc::Receiver;

use ready::{parse_ready_line, ReadyInfo};

const READY_TIMEOUT: Duration = Duration::from_secs(20);

struct Sidecar(Mutex<Option<CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            app.manage(Sidecar(Mutex::new(None)));
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = launch(handle.clone()).await {
                    eprintln!("Easy Race Timer: {error}");
                    show_error_page(&handle);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Easy Race Timer")
        .run(|app, event| {
            if should_stop(&event) {
                stop_sidecar(app);
            }
        });
}

fn should_stop(event: &tauri::RunEvent) -> bool {
    matches!(
        event,
        tauri::RunEvent::Exit
            | tauri::RunEvent::ExitRequested { .. }
            | tauri::RunEvent::WindowEvent {
                event: tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed,
                ..
            }
    )
}

async fn launch(app: tauri::AppHandle) -> Result<(), String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let data_dir = directory
        .to_str()
        .ok_or_else(|| "app data directory is not valid UTF-8".to_string())?
        .to_string();

    let (mut rx, child) = app
        .shell()
        .sidecar("ert-server")
        .map_err(|error| error.to_string())?
        .env("HOST", "127.0.0.1")
        .env("PORT", "0")
        .env("ERT_DATA_DIR", data_dir)
        .env("ERT_DB", "")
        .env("ERT_WEB_DIST", "")
        .env("ERT_TEST_MODE", "")
        .spawn()
        .map_err(|error| error.to_string())?;
    {
        let state = app.state::<Sidecar>();
        *state.0.lock().expect("sidecar lock") = Some(child);
    }

    let ready = match tokio::time::timeout(READY_TIMEOUT, wait_for_ready(&mut rx)).await {
        Ok(Ok(ready)) => ready,
        Ok(Err(error)) => {
            stop_sidecar(&app);
            return Err(error);
        }
        Err(_) => {
            stop_sidecar(&app);
            return Err("timed out after 20s waiting for ERT_READY".to_string());
        }
    };

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is missing".to_string())?;
    let url: tauri::Url = ready
        .url
        .parse()
        .map_err(|error: url::ParseError| error.to_string())?;
    window.navigate(url).map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

async fn wait_for_ready(rx: &mut Receiver<CommandEvent>) -> Result<ReadyInfo, String> {
    let mut pending = String::new();
    let mut stderr = String::new();
    loop {
        match rx.recv().await {
            Some(CommandEvent::Stdout(bytes)) => {
                pending.push_str(&String::from_utf8_lossy(&bytes));
                while let Some(index) = pending.find('\n') {
                    let line: String = pending.drain(..=index).collect();
                    if let Some(ready) = parse_ready_line(&line) {
                        return Ok(ready);
                    }
                }
            }
            Some(CommandEvent::Stderr(bytes)) => {
                append_tail(&mut stderr, &String::from_utf8_lossy(&bytes))
            }
            Some(CommandEvent::Terminated(payload)) => {
                if let Some(ready) = parse_ready_line(&pending) {
                    return Ok(ready);
                }
                let code = payload
                    .code
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "none".to_string());
                return Err(format!(
                    "sidecar exited before ERT_READY (code {code}): {stderr}"
                ));
            }
            Some(CommandEvent::Error(message)) => return Err(message),
            Some(_) => {}
            None => return Err(format!("sidecar output closed before ERT_READY: {stderr}")),
        }
    }
}

fn append_tail(tail: &mut String, chunk: &str) {
    tail.push_str(chunk);
    const MAX: usize = 4000;
    if tail.len() > MAX {
        let mut start = tail.len() - MAX;
        while !tail.is_char_boundary(start) {
            start += 1;
        }
        tail.replace_range(..start, "");
    }
}

fn show_error_page(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.show();
    let _ = window.set_focus();
}

fn stop_sidecar(app: &tauri::AppHandle) {
    let Some(child) = (|| -> Option<CommandChild> {
        let state = app.try_state::<Sidecar>()?;
        let mut guard = state.0.lock().expect("sidecar lock");
        guard.take()
    })() else {
        return;
    };
    let pid = child.pid();
    if let Err(error) = child.kill() {
        eprintln!("Easy Race Timer: failed to stop sidecar pid {pid}: {error}");
    }
}
