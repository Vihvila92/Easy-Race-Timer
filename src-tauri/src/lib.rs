// SPDX-License-Identifier: AGPL-3.0-only
//! Tauri shell for Easy Race Timer.
//!
//! The shell does not know race rules. It spawns the Node sidecar, passes a
//! per-launch token on stdin, waits for one `ERT_READY` line, and opens the
//! one-time auth URL. On failure it shows the static Finnish and English page
//! bundled as the window's local document.

mod ready;

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::Manager;

use ready::{launch_navigation_url, parse_ready_line, ReadyInfo};

const READY_TIMEOUT: Duration = Duration::from_secs(20);

struct SidecarProcess {
    child: Child,
    stdin: Option<ChildStdin>,
}

struct Sidecar(Mutex<Option<SidecarProcess>>);

#[cfg(windows)]
struct SidecarJob(Mutex<Option<job::KillOnCloseJob>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            app.manage(Sidecar(Mutex::new(None)));
            #[cfg(windows)]
            app.manage(SidecarJob(Mutex::new(None)));
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
    create_private_dir(&directory)?;
    let data_dir = directory
        .to_str()
        .ok_or_else(|| "app data directory is not valid UTF-8".to_string())?
        .to_string();
    let program = sidecar_program()?;
    let token = launch_token()?;

    let mut command = Command::new(&program);
    configure_sidecar(&mut command, &data_dir);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(
            program
                .parent()
                .ok_or_else(|| "sidecar directory is missing".to_string())?,
        );
    #[cfg(target_os = "linux")]
    unsafe {
        use std::os::unix::process::CommandExt;
        command.pre_exec(|| {
            let result = libc::prctl(
                libc::PR_SET_PDEATHSIG,
                libc::SIGKILL as libc::c_ulong,
                0,
                0,
                0,
            );
            if result != 0 {
                return Err(std::io::Error::last_os_error());
            }
            if libc::getppid() == 1 {
                libc::raise(libc::SIGKILL);
            }
            Ok(())
        });
    }

    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "sidecar stdin is missing".to_string())?;
    stdin
        .write_all(format!("{token}\n").as_bytes())
        .map_err(|error| error.to_string())?;
    stdin.flush().map_err(|error| error.to_string())?;

    #[cfg(windows)]
    assign_sidecar_job(&app, child.id());

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "sidecar stdout is missing".to_string())?;
    let stderr = child.stderr.take();
    let stderr_tail = Arc::new(Mutex::new(String::new()));
    if let Some(stderr) = stderr {
        let tail = Arc::clone(&stderr_tail);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut chunk = String::new();
            while reader.read_line(&mut chunk).unwrap_or(0) > 0 {
                if cfg!(debug_assertions) {
                    if let Ok(mut guard) = tail.lock() {
                        append_tail(&mut guard, &chunk);
                    }
                }
                chunk.clear();
            }
        });
    }
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(32);
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    if tx.blocking_send(line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    {
        let state = app.state::<Sidecar>();
        *state.0.lock().expect("sidecar lock") = Some(SidecarProcess {
            child,
            stdin: Some(stdin),
        });
    }

    let ready = match tokio::time::timeout(READY_TIMEOUT, wait_for_ready(&mut rx)).await {
        Ok(Ok(ready)) => ready,
        Ok(Err(())) => {
            stop_sidecar(&app);
            return Err(with_stderr("sidecar exited before ERT_READY", &stderr_tail));
        }
        Err(_) => {
            stop_sidecar(&app);
            return Err(with_stderr(
                "timed out after 20s waiting for ERT_READY",
                &stderr_tail,
            ));
        }
    };

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is missing".to_string())?;
    let url: tauri::Url = launch_navigation_url(&ready)
        .parse()
        .map_err(|error: url::ParseError| error.to_string())?;
    window.navigate(url).map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

async fn wait_for_ready(rx: &mut tokio::sync::mpsc::Receiver<String>) -> Result<ReadyInfo, ()> {
    while let Some(line) = rx.recv().await {
        if let Some(ready) = parse_ready_line(&line) {
            return Ok(ready);
        }
    }
    Err(())
}

fn with_stderr(message: &str, stderr: &Mutex<String>) -> String {
    if cfg!(debug_assertions) {
        if let Ok(tail) = stderr.lock() {
            if !tail.is_empty() {
                return format!("{message}: {tail}");
            }
        }
    }
    message.to_string()
}

/// Child environment after `env_clear`.
/// Windows copies only `SystemRoot` and `WINDIR` from the parent.
/// Every other parent variable stays unset.
fn sidecar_environment(
    parent: &[(&str, &str)],
    windows: bool,
    data_dir: &str,
) -> Vec<(String, String)> {
    let mut env = vec![
        ("HOST".to_string(), "127.0.0.1".to_string()),
        ("PORT".to_string(), "0".to_string()),
        ("ERT_DATA_DIR".to_string(), data_dir.to_string()),
        ("NODE_ENV".to_string(), "production".to_string()),
    ];
    if windows {
        for key in ["SystemRoot", "WINDIR"] {
            if let Some(value) = parent
                .iter()
                .find(|(name, _)| name.eq_ignore_ascii_case(key))
                .map(|(_, value)| *value)
            {
                env.push((key.to_string(), value.to_string()));
            }
        }
    } else {
        env.push(("LANG".to_string(), "C.UTF-8".to_string()));
    }
    env
}

fn configure_sidecar(command: &mut Command, data_dir: &str) {
    command.env_clear();
    let parent: Vec<(String, String)> = std::env::vars().collect();
    let borrowed: Vec<(&str, &str)> = parent
        .iter()
        .map(|(key, value)| (key.as_str(), value.as_str()))
        .collect();
    for (key, value) in sidecar_environment(&borrowed, cfg!(windows), data_dir) {
        command.env(key, value);
    }
}

fn launch_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|error| error.to_string())?;
    let mut hex = String::with_capacity(64);
    for byte in bytes {
        hex.push_str(&format!("{byte:02x}"));
    }
    Ok(hex)
}

fn sidecar_program() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let dir = exe
        .parent()
        .ok_or_else(|| "executable directory is missing".to_string())?;
    let extension = if cfg!(windows) { ".exe" } else { "" };
    let plain = dir.join(format!("ert-server{extension}"));
    if plain.is_file() {
        return Ok(plain);
    }
    if let Some(triple) = option_env!("TAURI_ENV_TARGET_TRIPLE") {
        let named = dir.join(format!("ert-server-{triple}{extension}"));
        if named.is_file() {
            return Ok(named);
        }
    }
    Err("sidecar ert-server is missing".to_string())
}

fn create_private_dir(directory: &std::path::Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(directory)
            .map_err(|error| error.to_string())?;
        std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(unix))]
    {
        std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    }
    Ok(())
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
    let Some(mut process) = (|| -> Option<SidecarProcess> {
        let state = app.try_state::<Sidecar>()?;
        let mut guard = state.0.lock().expect("sidecar lock");
        guard.take()
    })() else {
        return;
    };
    drop(process.stdin.take());
    let pid = process.child.id();
    let started = Instant::now();
    loop {
        match process.child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) if started.elapsed() < Duration::from_secs(2) => {
                std::thread::sleep(Duration::from_millis(50));
            }
            _ => break,
        }
    }
    if let Err(error) = process.child.kill() {
        eprintln!("Easy Race Timer: failed to stop sidecar pid {pid}: {error}");
    }
    let _ = process.child.wait();
}

#[cfg(test)]
mod env_tests {
    use super::sidecar_environment;

    #[test]
    fn windows_keeps_system_roots_and_drops_the_rest() {
        let parent = [
            ("SystemRoot", r"C:\Windows"),
            ("WINDIR", r"C:\Windows"),
            ("PATH", r"C:\evil"),
            ("NODE_OPTIONS", "--inspect"),
            ("ERT_DB_KEY", "secret"),
            ("HTTP_PROXY", "http://127.0.0.1:9"),
            ("USERPROFILE", r"C:\Users\runner"),
        ];
        let env = sidecar_environment(&parent, true, r"C:\data");
        let keys: Vec<&str> = env.iter().map(|(key, _)| key.as_str()).collect();
        assert_eq!(
            keys,
            [
                "HOST",
                "PORT",
                "ERT_DATA_DIR",
                "NODE_ENV",
                "SystemRoot",
                "WINDIR"
            ]
        );
        assert!(env
            .iter()
            .all(|(key, _)| *key != "PATH" && *key != "NODE_OPTIONS" && *key != "ERT_DB_KEY"));
        assert_eq!(
            env.iter()
                .find(|(key, _)| *key == "ERT_DATA_DIR")
                .map(|(_, value)| value.as_str()),
            Some(r"C:\data")
        );
    }

    #[test]
    fn windows_accepts_either_spelling_and_omits_a_missing_root() {
        let parent = [("SYSTEMROOT", r"D:\Windows"), ("windir", r"D:\Windows")];
        let env = sidecar_environment(&parent, true, r"D:\data");
        assert!(env
            .iter()
            .any(|(key, value)| key == "SystemRoot" && value == r"D:\Windows"));
        assert!(env
            .iter()
            .any(|(key, value)| key == "WINDIR" && value == r"D:\Windows"));
        let empty = sidecar_environment(&[], true, r"C:\data");
        assert!(empty
            .iter()
            .all(|(key, _)| key != "SystemRoot" && key != "WINDIR"));
    }

    #[test]
    fn unix_sets_lang_and_does_not_copy_the_parent() {
        let parent = [
            ("SystemRoot", r"C:\Windows"),
            ("PATH", "/tmp"),
            ("HOME", "/home/a"),
            ("NODE_OPTIONS", "--inspect"),
        ];
        let env = sidecar_environment(&parent, false, "/data");
        let keys: Vec<&str> = env.iter().map(|(key, _)| key.as_str()).collect();
        assert_eq!(keys, ["HOST", "PORT", "ERT_DATA_DIR", "NODE_ENV", "LANG"]);
        assert_eq!(
            env.iter()
                .find(|(key, _)| *key == "LANG")
                .map(|(_, value)| value.as_str()),
            Some("C.UTF-8")
        );
    }
}

#[cfg(windows)]
fn assign_sidecar_job(app: &tauri::AppHandle, pid: u32) {
    match job::assign(pid) {
        Ok(handle) => {
            if let Some(state) = app.try_state::<SidecarJob>() {
                *state.0.lock().expect("sidecar job") = Some(handle);
            }
        }
        Err(error) => {
            eprintln!("Easy Race Timer: could not assign the sidecar to a job object: {error}");
        }
    }
}

#[cfg(windows)]
mod job {
    use std::io::Error;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    /// Owned job-object handle. Stored as an integer so Tauri can keep it in
    /// app state, which requires `Send`. `CloseHandle` runs only from `Drop`.
    pub struct KillOnCloseJob(isize);

    impl Drop for KillOnCloseJob {
        fn drop(&mut self) {
            if self.0 != 0 {
                unsafe {
                    CloseHandle(self.0 as HANDLE);
                }
            }
        }
    }

    pub fn assign(pid: u32) -> Result<KillOnCloseJob, String> {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err(Error::last_os_error().to_string());
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let configured = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if configured == 0 {
                CloseHandle(job);
                return Err(Error::last_os_error().to_string());
            }
            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if process.is_null() {
                CloseHandle(job);
                return Err(Error::last_os_error().to_string());
            }
            let assigned = AssignProcessToJobObject(job, process);
            CloseHandle(process);
            if assigned == 0 {
                let error = Error::last_os_error();
                CloseHandle(job);
                return Err(error.to_string());
            }
            Ok(KillOnCloseJob(job as isize))
        }
    }
}
