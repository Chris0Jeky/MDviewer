//! OS change notifications for the folders of open, bound documents. No polling:
//! `notify` uses ReadDirectoryChangesW on Windows. The watcher starts with the
//! first bound document, watches each parent folder once (non-recursively), and
//! coalesces bursts into one notification that carries capability tokens only.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};

use crate::registry::Token;

/// A burst of writes (an editor's temp-and-rename save, an agent rewriting a file)
/// becomes one notification once the folder has been quiet this long.
pub const QUIET: Duration = Duration::from_millis(150);

/// A file that never goes quiet (a log appended every 50 ms) still notifies this
/// long after its first pending event. The webview's re-read is fenced, so an
/// extra notification is safe.
pub const MAX_WAIT: Duration = Duration::from_secs(1);

/// The debounce rule as a pure, clock-injected unit: the thread feeds it
/// `Instant`s, tests feed it made-up ones.
#[derive(Default)]
struct Debounce {
    files: HashSet<String>,
    /// First and latest event time of the pending burst.
    span: Option<(Instant, Instant)>,
}

impl Debounce {
    fn touch(&mut self, file: String, now: Instant) {
        self.files.insert(file);
        let span = self.span.get_or_insert((now, now));
        span.1 = now;
    }

    fn deadline(&self) -> Option<Instant> {
        self.span
            .map(|(first, last)| (last + QUIET).min(first + MAX_WAIT))
    }

    fn take_due(&mut self, now: Instant) -> Vec<String> {
        match self.deadline() {
            Some(deadline) if deadline <= now => {
                self.span = None;
                self.files.drain().collect()
            }
            _ => Vec::new(),
        }
    }
}

type Sink = Arc<dyn Fn(Vec<Token>) + Send + Sync>;

#[derive(Default)]
struct Targets {
    /// Folder -> number of bound files watched in it.
    dirs: HashMap<PathBuf, usize>,
    /// Normalised file path -> tokens bound to it (duplicate opens stay distinct).
    files: HashMap<String, HashSet<Token>>,
}

struct Running {
    watcher: RecommendedWatcher,
    changes: Sender<PathBuf>,
}

pub struct FileWatch {
    sink: Sink,
    targets: Arc<Mutex<Targets>>,
    running: Mutex<Option<Running>>,
}

/// Windows paths compare case-insensitively; events report the on-disk case.
fn key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl FileWatch {
    pub fn new(sink: impl Fn(Vec<Token>) + Send + Sync + 'static) -> Self {
        Self {
            sink: Arc::new(sink),
            targets: Arc::default(),
            running: Mutex::new(None),
        }
    }

    fn start(&self) -> notify::Result<Running> {
        let (changes, received) = mpsc::channel::<PathBuf>();
        let forward = changes.clone();
        let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            // Errors (e.g. a buffer overflow) mean "something changed here".
            match event {
                Ok(event) => event.paths.into_iter().for_each(|path| {
                    let _ = forward.send(path);
                }),
                Err(error) => error.paths.into_iter().for_each(|path| {
                    let _ = forward.send(path);
                }),
            }
        })?;
        let targets = self.targets.clone();
        let sink = self.sink.clone();
        std::thread::Builder::new()
            .name("mdviewer-watch".into())
            .spawn(move || {
                let mut debounce = Debounce::default();
                loop {
                    let wait = debounce
                        .deadline()
                        .map_or(Duration::from_secs(3600), |due| {
                            due.saturating_duration_since(Instant::now())
                        });
                    match received.recv_timeout(wait) {
                        Ok(path) => {
                            let path_key = key(&path);
                            // A folder event (overflow, folder renamed) touches every file in it.
                            let targets = lock(&targets);
                            let now = Instant::now();
                            if targets.files.contains_key(&path_key) {
                                debounce.touch(path_key, now);
                            } else {
                                let folder = format!("{path_key}\\");
                                for file in targets.files.keys().filter(|f| f.starts_with(&folder))
                                {
                                    debounce.touch(file.clone(), now);
                                }
                            }
                        }
                        Err(RecvTimeoutError::Timeout) => {}
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                    // Checked after every event too: a constant stream never times out.
                    let due = debounce.take_due(Instant::now());
                    if !due.is_empty() {
                        let tokens: Vec<Token> = {
                            let targets = lock(&targets);
                            due.iter()
                                .filter_map(|file| targets.files.get(file))
                                .flatten()
                                .cloned()
                                .collect()
                        };
                        if !tokens.is_empty() {
                            sink(tokens);
                        }
                    }
                }
            })
            .map_err(notify::Error::io)?;
        Ok(Running { watcher, changes })
    }

    /// Follow `path` for `token`. Failure to watch never blocks opening a file.
    pub fn add(&self, token: &Token, path: &Path) {
        let Some(dir) = path.parent().map(Path::to_path_buf) else {
            return;
        };
        let mut running = lock(&self.running);
        if running.is_none() {
            match self.start() {
                Ok(started) => *running = Some(started),
                Err(_) => return,
            }
        }
        let watcher = &mut running.as_mut().unwrap().watcher;
        let mut targets = lock(&self.targets);
        let count = targets.dirs.entry(dir.clone()).or_insert(0);
        if *count == 0 && watcher.watch(&dir, RecursiveMode::NonRecursive).is_err() {
            targets.dirs.remove(&dir);
            return;
        }
        *count += 1;
        targets
            .files
            .entry(key(path))
            .or_default()
            .insert(token.clone());
    }

    /// Stop following `token`; unwatches its folder with the folder's last file.
    pub fn remove(&self, token: &Token) {
        let mut running = lock(&self.running);
        let mut targets = lock(&self.targets);
        let Some(file) = targets
            .files
            .iter()
            .find(|(_, tokens)| tokens.contains(token))
            .map(|(file, _)| file.clone())
        else {
            return;
        };
        let tokens = targets.files.get_mut(&file).unwrap();
        tokens.remove(token);
        if tokens.is_empty() {
            targets.files.remove(&file);
        }
        let path = PathBuf::from(&file);
        let Some(dir) = path.parent() else { return };
        let dir = targets
            .dirs
            .keys()
            .find(|watched| key(watched) == key(dir))
            .cloned();
        let Some(dir) = dir else { return };
        let dir = dir.as_path();
        if let Some(count) = targets.dirs.get_mut(dir) {
            *count -= 1;
            if *count == 0 {
                targets.dirs.remove(dir);
                if let Some(running) = running.as_mut() {
                    let _ = running.watcher.unwatch(dir);
                }
            }
        }
    }

    #[cfg(test)]
    fn watched_dirs(&self) -> usize {
        lock(&self.targets).dirs.len()
    }

    #[cfg(test)]
    fn started(&self) -> bool {
        lock(&self.running).is_some()
    }
}

impl Drop for FileWatch {
    fn drop(&mut self) {
        // Dropping the sender ends the debounce thread once the watcher is gone.
        if let Some(running) = lock(&self.running).take() {
            drop(running.watcher);
            drop(running.changes);
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::process::Command;

    fn token(n: u8) -> Token {
        Token::parse(&format!("{n:032x}")).unwrap()
    }

    fn collect() -> (FileWatch, Arc<Mutex<Vec<Vec<Token>>>>) {
        let seen: Arc<Mutex<Vec<Vec<Token>>>> = Arc::default();
        let sink = seen.clone();
        (FileWatch::new(move |tokens| lock(&sink).push(tokens)), seen)
    }

    fn settle(seen: &Arc<Mutex<Vec<Vec<Token>>>>, expected: usize) {
        let start = Instant::now();
        while lock(seen).len() < expected && start.elapsed() < Duration::from_secs(10) {
            std::thread::sleep(Duration::from_millis(20));
        }
        // Then prove nothing further arrives after the quiet period.
        std::thread::sleep(QUIET * 4);
    }

    #[test]
    fn starts_lazily_and_one_burst_from_another_process_is_one_notification() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("agent notes é.md");
        std::fs::write(&path, b"one").unwrap();
        let other = dir.path().join("unrelated.md");
        std::fs::write(&other, b"x").unwrap();
        let (watch, seen) = collect();
        assert!(
            !watch.started(),
            "nothing runs before a bound document exists"
        );
        watch.add(&token(1), &path);
        watch.add(&token(2), &path); // A duplicate open of the same file.
        assert!(watch.started());
        assert_eq!(watch.watched_dirs(), 1);
        // A separate process rewrites the file five times in quick succession,
        // and also touches an unrelated file in the same folder.
        let script = format!(
            "1..5 | ForEach-Object {{ [IO.File]::WriteAllText('{}', \"rev $_\") }}; [IO.File]::WriteAllText('{}', 'y')",
            path.display(),
            other.display()
        );
        let status = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .status()
            .unwrap();
        assert!(status.success());
        settle(&seen, 1);
        let seen = lock(&seen);
        assert_eq!(seen.len(), 1, "one coalesced notification: {seen:?}");
        let tokens: HashSet<_> = seen[0].iter().cloned().collect();
        assert_eq!(tokens, HashSet::from([token(1), token(2)]));
    }

    #[test]
    fn a_file_appended_every_50ms_notifies_within_the_maximum_delay() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("busy.log");
        std::fs::write(&path, b"start\n").unwrap();
        let (watch, seen) = collect();
        watch.add(&token(4), &path);
        let started = Instant::now();
        let writer = {
            let path = path.clone();
            std::thread::spawn(move || {
                // Reopen per line, as a logger does: an open handle defers NTFS's
                // directory-entry update, so the OS would report nothing.
                for _ in 0..40 {
                    let mut file = std::fs::OpenOptions::new()
                        .append(true)
                        .open(&path)
                        .unwrap();
                    file.write_all(b"line\n").unwrap();
                    drop(file);
                    std::thread::sleep(Duration::from_millis(50));
                }
            })
        };
        while lock(&seen).is_empty() && started.elapsed() < Duration::from_millis(1200) {
            std::thread::sleep(Duration::from_millis(20));
        }
        let first = started.elapsed();
        let notified = lock(&seen).len();
        writer.join().unwrap();
        assert!(
            notified >= 1,
            "no notification within 1.2 s of continuous appends"
        );
        assert!(first < Duration::from_millis(1200), "first at {first:?}");
    }

    #[test]
    fn rename_and_delete_notify_and_removal_unwatches_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        std::fs::write(&path, b"one").unwrap();
        let (watch, seen) = collect();
        watch.add(&token(3), &path);
        std::fs::rename(&path, dir.path().join("moved.md")).unwrap();
        settle(&seen, 1);
        assert_eq!(*lock(&seen), vec![vec![token(3)]]);
        watch.remove(&token(3));
        assert_eq!(watch.watched_dirs(), 0);
        std::fs::write(&path, b"back").unwrap();
        std::thread::sleep(QUIET * 4);
        assert_eq!(lock(&seen).len(), 1, "an unwatched file never notifies");
    }
}

#[cfg(test)]
mod debounce_tests {
    use super::*;

    fn at(base: Instant, ms: u64) -> Instant {
        base + Duration::from_millis(ms)
    }

    #[test]
    fn a_quiet_burst_notifies_once_after_the_quiet_window() {
        let t0 = Instant::now();
        let mut d = Debounce::default();
        d.touch("a".into(), at(t0, 0));
        d.touch("a".into(), at(t0, 100));
        assert!(d.take_due(at(t0, 249)).is_empty());
        assert_eq!(d.take_due(at(t0, 250)), vec!["a".to_string()]);
        assert!(d.take_due(at(t0, 5000)).is_empty());
    }

    #[test]
    fn a_file_appended_every_50ms_notifies_by_the_maximum_delay() {
        let t0 = Instant::now();
        let mut d = Debounce::default();
        let mut first = None;
        for step in 0..=40 {
            let now = at(t0, step * 50);
            d.touch("log".into(), now);
            if first.is_none() && !d.take_due(now).is_empty() {
                first = Some(step * 50);
            }
        }
        assert_eq!(first, Some(1000));
    }
}
