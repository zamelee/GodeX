use crate::strip_ansi::strip_ansi;
use chrono::Utc;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::path::Path;
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
        Self { ts: Utc::now().timestamp_millis(), level: classify(&text), source: "studio".into(), text }
    }
    pub fn godex(text: String) -> Self {
        let cleaned = strip_ansi(&text);
        let level = classify(&cleaned);
        Self { ts: Utc::now().timestamp_millis(), level, source: "godex".into(), text: cleaned }
    }
}

/// LogLine variant for `tail_trace_logs`. Carries the sqlite row id so the
/// JS caller can do incremental polling without re-fetching / deduping.
#[derive(Clone, Debug, Serialize)]
pub struct TraceLogLine {
    pub id: i64,
    pub ts: i64,
    pub level: String,
    pub source: String,
    pub text: String,
}

fn classify(text: &str) -> String {
    let lower = text.to_lowercase();
    if lower.contains(" error") || lower.contains("err ") || lower.starts_with("err") {
        "error".into()
    } else if lower.contains(" warn") {
        "warn".into()
    } else {
        "info".into()
    }
}

pub struct GodexSupervisor {
    child: Mutex<Option<Child>>,
    buffer: Mutex<VecDeque<LogLine>>,
    config: Mutex<Option<PathBuf>>,
    binary: Mutex<Option<PathBuf>>,
    port: Mutex<Option<u16>>,
    external_mode: Mutex<bool>,
    replica_mode: Mutex<bool>,
    replica_binary: Mutex<Option<PathBuf>>,
    replica_pid: Mutex<Option<u32>>,
}

impl GodexSupervisor {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            buffer: Mutex::new(VecDeque::with_capacity(RING_BUFFER_LIMIT)),
            config: Mutex::new(None),
            binary: Mutex::new(None),
            port: Mutex::new(None),
            external_mode: Mutex::new(false),
            replica_mode: Mutex::new(false),
            replica_binary: Mutex::new(None),
            replica_pid: Mutex::new(None),
        }
    }

    pub fn set_paths(&self, config: PathBuf, binary: PathBuf, port: u16) {
        *self.config.lock() = Some(config);
        *self.binary.lock() = Some(binary);
        *self.port.lock() = Some(port);
    }

    pub fn set_external_mode(&self, mode: bool) {
        *self.external_mode.lock() = mode;
    }

    pub fn is_external_mode(&self) -> bool {
        *self.external_mode.lock()
    }

    fn push_internal(&self, line: LogLine) {
        let mut buf = self.buffer.lock();
        if buf.len() >= RING_BUFFER_LIMIT { buf.pop_front(); }
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

    pub fn clear(&self) { self.buffer.lock().clear(); }
    pub fn pid(&self) -> Option<u32> { self.child.lock().as_ref().map(|c| c.id()) }

    pub fn kill(&self) {
        if let Some(mut child) = self.child.lock().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    pub fn set_replica_mode(&self, enabled: bool) {
        *self.replica_mode.lock() = enabled;
    }

    pub fn is_replica_mode(&self) -> bool {
        *self.replica_mode.lock()
    }

    pub fn get_replica_binary(&self) -> Option<PathBuf> {
        self.replica_binary.lock().clone()
    }

    /// Compute the replica path: {original_dir}/{original_name}-{date}-temp-copy.exe
    fn compute_replica_path(original: &Path) -> Option<PathBuf> {
        let parent = original.parent()?;
        let stem = original.file_stem()?.to_str()?;
        let ext = original.extension().and_then(|e| e.to_str()).unwrap_or("");
        let date = chrono::Utc::now().format("%Y-%m-%d");
        let name = if ext.is_empty() {
            format!("{}-{:?}-temp-copy", stem, date)
        } else {
            format!("{}-{:?}-temp-copy.{}", stem, date, ext)
        };
        Some(parent.join(name))
    }

    /// Check if replica exists and matches the original's MD5
    fn is_replica_fresh(replica: &Path, original: &Path) -> Option<bool> {
        use std::fs::File;
        use std::io::{BufReader, Read};

        fn md5_of(path: &Path) -> Option<String> {
            let file = File::open(path).ok()?;
            let mut reader = BufReader::new(file);
            let mut ctx = md5::Context::new();
            let mut buf = [0u8; 8192];
            loop {
                let n = reader.read(&mut buf).ok()?;
                if n == 0 { break; }
                ctx.consume(&buf[..n]);
            }
            Some(format!("{:x}", ctx.compute()))
        }

        let orig_md5 = md5_of(original)?;
        let repl_md5 = md5_of(replica)?;
        Some(orig_md5 == repl_md5)
    }

    /// Ensure replica exists and is fresh, then start it.
    /// Returns (replica_pid, replica_path).
    pub fn ensure_and_start_replica(&self, app: &AppHandle) -> Result<(u32, PathBuf), String> {
        let original = self.binary.lock().clone()
            .ok_or("binary not set")?;
        let config = self.config.lock().clone()
            .ok_or("config not set")?;

        let replica_path = Self::compute_replica_path(&original)
            .ok_or("cannot compute replica path")?;

        // Kill existing replica if running
        self.kill_replica();

        // Copy if needed
        if !replica_path.exists() || Self::is_replica_fresh(&replica_path, &original) != Some(true) {
            self.push_and_emit(app, LogLine::studio(format!(
                "[replica] copying {} -> {}",
                original.display(), replica_path.display()
            )));
            std::fs::copy(&original, &replica_path)
                .map_err(|e| format!("copy failed: {}", e))?;
        }

        let port = self.port.lock().unwrap_or_else(|| crate::state::read_port_from_config(&config));
        let port_arg = format!("--port={}", port);

        let child = std::process::Command::new(&replica_path)
            .arg("--config")
            .arg(&config)
            .arg(&port_arg)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("spawn replica failed: {}", e))?;

        let pid = child.id();
        *self.replica_pid.lock() = Some(pid);
        *self.replica_binary.lock() = Some(replica_path.clone());

        self.push_and_emit(app, LogLine::studio(format!(
            "[replica] started pid={} at {}", pid, replica_path.display()
        )));

        Ok((pid, replica_path))
    }

    pub fn kill_replica(&self) {
        if let Some(pid) = self.replica_pid.lock().take() {
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/PID", &pid.to_string()])
                .output();
        }
        *self.replica_binary.lock() = None;
    }

    pub fn replica_pid(&self) -> Option<u32> {
        *self.replica_pid.lock()
    }

    /// Fire-and-forget start. Returns immediately; actual work runs in a background
    /// thread to keep the Tauri main thread responsive. UI is updated via
    /// godex://log events.
    pub fn start(self: &Arc<Self>, app: AppHandle) {
        let sup = self.clone();
        thread::spawn(move || {
            match GodexSupervisor::start_blocking(&sup, &app) {
                Ok(pid) => {
                    sup.push_and_emit(&app, LogLine::studio(format!("[studio] godex pid={} started", pid)));
                }
                Err(e) => {
                    sup.push_and_emit(&app, LogLine::studio(format!("[studio] godex start failed: {}", e)));
                }
            }
        });
    }

    fn start_blocking(self: &Arc<Self>, app: &AppHandle) -> Result<u32, String> {
        self.kill();

        let config = self.config.lock().clone().ok_or("config not set")?;
        let binary = self.binary.lock().clone().ok_or("binary not set")?;
        if !binary.exists() { return Err(format!("binary not found: {}", binary.display())); }
        if !config.exists() { return Err(format!("config not found: {}", config.display())); }

        let external = *self.external_mode.lock();
        let port = self.port.lock().unwrap_or_else(|| crate::state::read_port_from_config(&config));

        if external {
            // External mode: detect if godex is already running on the port.
            if let Some((pid, name)) = detect_process_on_port(port) {
                self.push_and_emit(app, LogLine::studio(format!("[studio] external godex detected pid={} ({}) on port {}", pid, name, port)));
                return Ok(pid);
            }
            // No external godex; fall through to spawn visible godex.
            self.push_and_emit(app, LogLine::studio(format!("[studio] no godex on port {}, spawning visible godex", port)));
        } else {
            // Internal mode: kill anything on the port, spawn hidden godex.
            if port > 0 {
                let killed = kill_process_on_port(port);
                for (pid, name) in &killed {
                    eprintln!("[studio] killed pid={} ({}) on port {}", pid, name, port);
                }
                if !killed.is_empty() {
                    thread::sleep(std::time::Duration::from_millis(150));
                }
            }
        }

        GodexSupervisor::spawn_godex_child(self, &config, &binary, external, app)
    }

    fn spawn_godex_child(self: &Arc<Self>, config: &PathBuf, binary: &PathBuf, external: bool, app: &AppHandle) -> Result<u32, String> {
        let mut cmd = Command::new(binary);
        cmd.arg("--config").arg(config);
        cmd.arg("--log-level").arg("info");
        cmd.stdin(Stdio::null());

        if external {
            // External: visible window (no CREATE_NO_WINDOW)
        } else {
            cmd.stdout(Stdio::piped());
            cmd.stderr(Stdio::piped());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                cmd.creation_flags(CREATE_NO_WINDOW);
            }
        }

        let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {}", e))?;
        let pid = child.id();

        if !external {
            if let Some(stdout) = child.stdout.take() {
                let sup = self.clone();
                let app_clone = app.clone();
                thread::spawn(move || {
                    let reader = BufReader::new(stdout);
                    for line in reader.lines().map_while(Result::ok) {
                        let ll = LogLine::godex(line);
                        sup.push_internal(ll.clone());
                        let _ = app_clone.emit("godex://log", ll);
                    }
                });
            }
            if let Some(stderr) = child.stderr.take() {
                let sup = self.clone();
                let app_clone = app.clone();
                thread::spawn(move || {
                    let reader = BufReader::new(stderr);
                    for line in reader.lines().map_while(Result::ok) {
                        let mut ll = LogLine::godex(line);
                        ll.level = "error".into();
                        sup.push_internal(ll.clone());
                        let _ = app_clone.emit("godex://log", ll);
                    }
                });
            }
        }

        *self.child.lock() = Some(child);
        Ok(pid)
    }

    pub fn tail_trace_logs(&self, limit: usize, from_id: Option<i64>) -> Vec<TraceLogLine> {
        let config = match self.config.lock().clone() {
            Some(c) => c,
            None => return vec![],
        };
        // Note: the logging.file branch is intentionally skipped here —
        // Studio and godex disagree on the schema (string path vs nested
        // {enabled, dir, filename} object). Stick with trace.db.





        tail_trace_db_from_config(&config, limit, from_id)
    }
}

#[allow(dead_code)]
fn tail_file_last_n(path: &std::path::Path, n: usize) -> std::io::Result<Vec<LogLine>> {
    use std::io::{BufRead, BufReader};
    let file = std::fs::File::open(path)?;
    let reader = BufReader::new(file);
    let all_lines: Vec<String> = reader.lines().filter_map(Result::ok).collect();
    let start = if all_lines.len() > n { all_lines.len() - n } else { 0 };
    let now = chrono::Utc::now().timestamp_millis();
    let result: Vec<LogLine> = all_lines[start..]
        .iter()
        .enumerate()
        .map(|(i, line)| {
            let ts = now - ((all_lines.len() - start - i) as i64 * 1000);
            let cleaned = crate::strip_ansi::strip_ansi(line);
            LogLine { ts, level: classify(&cleaned), source: "logfile".into(), text: cleaned }
        })
        .collect();
    Ok(result)
}

fn tail_trace_db_from_config(config: &std::path::Path, limit: usize, from_id: Option<i64>) -> Vec<TraceLogLine> {
    // Godex persists trace rows under <config-dir>/data/trace.db in four
    // tables: trace_requests / trace_usage / trace_events / trace_errors. We
    // surface events + errors here so the log panel shows what happened when
    // the upstream call ran, including per-stream deltas and error context.
    //
    // Performance: the table has 6+ GB and no `created_at` index. We order by
    // `id` (the sqlite rowid, indexed automatically) and let the JS caller
    // pass `from_id` for incremental polling — steady state is O(LIMIT).
    let db_dir = config.parent().unwrap_or(config);
    let db_path = db_dir.join("data").join("trace.db");
    if !db_path.exists() { return vec![]; }
    let conn = match rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    // First-time fetch: ORDER BY id DESC LIMIT N (newest N rows).
    // Incremental fetch: WHERE id > ? ORDER BY id ASC LIMIT N (rows newer than last seen).
    let since = from_id.unwrap_or(0);
    let is_incremental = from_id.is_some();
    let query = if is_incremental {
        "SELECT id, created_at, event_name, payload_json, is_error, kind FROM (
            SELECT id, created_at, event_name, payload_json, 0 AS is_error, 'event' AS kind FROM trace_events WHERE id > ?
            UNION ALL
            SELECT id, created_at, event_name, message AS payload_json, 1 AS is_error, 'error' AS kind FROM trace_errors WHERE id > ?
        ) ORDER BY id ASC LIMIT ?"
    } else {
        "SELECT id, created_at, event_name, payload_json, is_error, kind FROM (
            SELECT id, created_at, event_name, payload_json, 0 AS is_error, 'event' AS kind FROM trace_events
            UNION ALL
            SELECT id, created_at, event_name, message AS payload_json, 1 AS is_error, 'error' AS kind FROM trace_errors
        ) ORDER BY id DESC LIMIT ?"
    };

    let mut stmt = match conn.prepare(&query) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let params: Vec<Box<dyn rusqlite::ToSql>> = if is_incremental {
        vec![Box::new(since), Box::new(since), Box::new(limit as i64)]
    } else {
        vec![Box::new(limit as i64)]
    };
    let row_iter = stmt.query_map(rusqlite::params_from_iter(params.iter()), |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, String>(5)?,
        ))
    });
    let row_iter = match row_iter {
        Ok(it) => it,
        Err(_) => return vec![],
    };

    let mut rows: Vec<(i64, i64, String, Option<String>, i64, String)> = Vec::new();
    for r in row_iter.flatten() { rows.push(r); }
    if !is_incremental { rows.reverse(); }

    let mut out: Vec<TraceLogLine> = Vec::with_capacity(rows.len());
    for (id, ts, event_name, payload, is_error, kind) in rows {
        let payload = payload.unwrap_or_default();
        // Truncate at a char boundary to avoid panic on UTF-8 payloads.
        // `&payload[..400]` is a BYTE slice and panics if 400 lands inside
        // a multi-byte codepoint. We use `char_indices` to find the largest
        // byte index strictly less than 400 that is a char boundary.
        let trimmed = if payload.len() > 400 {
            let cut = payload
                .char_indices()
                .map(|(i, _)| i)
                .take_while(|&i| i < 400)
                .last()
                .unwrap_or(0);
            format!("{}...", &payload[..cut])
        } else {
            payload
        };
        let text = if trimmed.is_empty() {
            format!("[{}#{}]", event_name, id)
        } else {
            format!("[{}#{}] {}", event_name, id, trimmed)
        };
        let level = if is_error != 0 { "error".to_string() } else { classify(&text) };
        let _ = kind;
        out.push(TraceLogLine {
            id,
            ts,
            level,
            source: "trace".into(),
            text,
        });
    }
    out
}
/// Detect the PID and process name of a process listening on the given port.
/// Returns None if no such process is found.
fn detect_process_on_port(port: u16) -> Option<(u32, String)> {
    let self_pid = std::process::id();
    let out = Command::new("netstat").args(["-ano", "-p", "tcp"]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let needle = format!(":{}", port);
    for line in text.lines() {
        if !line.contains("LISTENING") || !line.contains(&needle) { continue; }
        if let Some(pid_str) = line.split_whitespace().last() {
            if let Ok(pid) = pid_str.parse::<u32>() {
                if pid != 0 && pid != self_pid {
                    let name = process_name_for_pid(pid).unwrap_or_else(|| "?".into());
                    return Some((pid, name));
                }
            }
        }
    }
    None
}

fn kill_process_on_port(port: u16) -> Vec<(u32, String)> {
    let self_pid = std::process::id();
    let mut killed = Vec::new();
    let out = match Command::new("netstat").args(["-ano", "-p", "tcp"]).output() {
        Ok(o) => o,
        Err(_) => return killed,
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let needle = format!(":{}", port);
    let mut pids = std::collections::HashSet::new();
    for line in text.lines() {
        if !line.contains("LISTENING") || !line.contains(&needle) { continue; }
        if let Some(pid_str) = line.split_whitespace().last() {
            if let Ok(pid) = pid_str.parse::<u32>() {
                if pid != 0 && pid != self_pid { pids.insert(pid); }
            }
        }
    }
    for pid in pids {
        let name = process_name_for_pid(pid).unwrap_or_else(|| "?".into());
        let _ = Command::new("taskkill").args(["/F", "/PID", &pid.to_string()]).output();
        killed.push((pid, name));
    }
    killed
}

fn process_name_for_pid(pid: u32) -> Option<String> {
    let out = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"])
        .output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let first = text.lines().next()?;
    let name = first.split(",").next()?.chars().filter(|c| *c != ',' && *c != ' ').collect::<String>();
    if name.is_empty() { None } else { Some(name.to_string()) }
}
