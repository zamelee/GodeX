use crate::strip_ansi::strip_ansi;
use chrono::Utc;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter};

const RING_BUFFER_LIMIT: usize = 1000;

#[derive(Clone, Debug, Serialize)]
pub struct LogLine {
    pub ts: i64,
    pub level: String,
    pub source: String,
    pub text: String,
}

impl LogLine {
    pub fn studio(text: String) -> Self {
        Self {
            ts: Utc::now().timestamp_millis(),
            level: classify(&text),
            source: "studio".to_string(),
            text,
        }
    }

    pub fn godex(text: String) -> Self {
        let cleaned = strip_ansi(&text);
        let level = classify(&cleaned);
        Self {
            ts: Utc::now().timestamp_millis(),
            level,
            source: "godex".to_string(),
            text: cleaned,
        }
    }
}

fn classify(text: &str) -> String {
    let lower = text.to_lowercase();
    if lower.contains(" error") || lower.contains("err ") || lower.starts_with("err") {
        "error".to_string()
    } else if lower.contains(" warn") {
        "warn".to_string()
    } else {
        "info".to_string()
    }
}

pub struct GodexSupervisor {
    child: Mutex<Option<Child>>,
    buffer: Mutex<VecDeque<LogLine>>,
    config: Mutex<Option<PathBuf>>,
    binary: Mutex<Option<PathBuf>>,
    port: Mutex<Option<u16>>,
}

impl GodexSupervisor {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            buffer: Mutex::new(VecDeque::with_capacity(RING_BUFFER_LIMIT)),
            config: Mutex::new(None),
            binary: Mutex::new(None),
            port: Mutex::new(None),
        }
    }

    pub fn set_paths(&self, config: PathBuf, binary: PathBuf, port: u16) {
        *self.config.lock() = Some(config);
        *self.binary.lock() = Some(binary);
        *self.port.lock() = Some(port);
    }

    fn push_internal(&self, line: LogLine) {
        let mut buf = self.buffer.lock();
        if buf.len() >= RING_BUFFER_LIMIT {
            buf.pop_front();
        }
        buf.push_back(line);
    }

    pub fn push_and_emit(&self, app: &AppHandle, line: LogLine) {
        self.push_internal(line.clone());
        let _ = app.emit("godex://log", line);
    }

    pub fn tail(&self, limit: usize) -> Vec<LogLine> {
        let buf = self.buffer.lock();
        let n = buf.len().min(limit);
        buf.iter().skip(buf.len() - n).cloned().collect()
    }

    pub fn clear(&self) {
        self.buffer.lock().clear();
    }

    pub fn pid(&self) -> Option<u32> {
        self.child.lock().as_ref().map(|c| c.id())
    }

    pub fn kill(&self) {
        if let Some(mut child) = self.child.lock().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    pub fn start(self: &Arc<Self>, app: &AppHandle) -> Result<u32, String> {
        self.kill();

        let config = self.config.lock().clone().ok_or_else(|| "config not set".to_string())?;
        let binary = self.binary.lock().clone().ok_or_else(|| "binary not set".to_string())?;

        if !binary.exists() {
            return Err(format!("binary not found: {}", binary.display()));
        }
        if !config.exists() {
            return Err(format!("config not found: {}", config.display()));
        }

        // Determine the target port (prefer tracked, else read from config)
        let port = self.port.lock().unwrap_or_else(|| crate::state::read_port_from_config(&config));
        if port > 0 {
            let killed = kill_process_on_port(port);
            for (pid, name) in &killed {
                self.push_and_emit(app, LogLine::studio(format!("[studio] killed pid={} ({}) on port {}", pid, name, port)));
            }
            if killed.is_empty() {
                self.push_and_emit(app, LogLine::studio(format!("[studio] port {} is free", port)));
            }
            if !killed.is_empty() {
                std::thread::sleep(std::time::Duration::from_millis(150));
            }
        }

        let mut cmd = Command::new(&binary);
        cmd.arg("--config").arg(&config);
        cmd.arg("--log-level").arg("info");
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {}", e))?;
        let pid = child.id();

        self.push_and_emit(app, LogLine::studio(format!("[studio] godex started pid={}", pid)));

        if let Some(stdout) = child.stdout.take() {
            let app_handle = app.clone();
            let sup = Arc::clone(self);
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines().map_while(Result::ok) {
                    let ll = LogLine::godex(line);
                    sup.push_internal(ll.clone());
                    let _ = app_handle.emit("godex://log", ll);
                }
            });
        }
        if let Some(stderr) = child.stderr.take() {
            let app_handle = app.clone();
            let sup = Arc::clone(self);
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    let mut ll = LogLine::godex(line);
                    ll.level = "error".to_string();
                    sup.push_internal(ll.clone());
                    let _ = app_handle.emit("godex://log", ll);
                }
            });
        }

        *self.child.lock() = Some(child);
        Ok(pid)
    }
}


/// Find and kill processes listening on the given TCP port. Returns the list
/// of (pid, process_name) that were killed. Skips the current process.
fn kill_process_on_port(port: u16) -> Vec<(u32, String)> {
    let self_pid = std::process::id();
    let mut killed: Vec<(u32, String)> = Vec::new();
    let out = match std::process::Command::new("netstat").args(["-ano", "-p", "tcp"]).output() {
        Ok(o) => o,
        Err(_) => return killed,
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let needle = format!(":{}", port);
    let mut pids: std::collections::HashSet<u32> = std::collections::HashSet::new();
    for line in text.lines() {
        if !line.contains("LISTENING") {
            continue;
        }
        if !line.contains(&needle) {
            continue;
        }
        if let Some(pid_str) = line.split_whitespace().last() {
            if let Ok(pid) = pid_str.parse::<u32>() {
                if pid != 0 && pid != self_pid {
                    pids.insert(pid);
                }
            }
        }
    }
    for pid in pids {
        let name = process_name_for_pid(pid).unwrap_or_else(|| "?".to_string());
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string()])
            .output();
        killed.push((pid, name));
    }
    killed
}

fn process_name_for_pid(pid: u32) -> Option<String> {
    let out = std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let first = text.lines().next()?;
    let name = first.split(',').next()?.trim_matches(|c| c == '"' || c == ' ');
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}
