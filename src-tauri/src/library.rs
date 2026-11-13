//! The persisted library (companion push S4): recent files, pinned files, pinned
//! project folders and "last looked at" stamps. Only absolute paths and Unix
//! millisecond timestamps are stored — never document content — in
//! `library.json` under the app's local data folder. The webview refers to
//! entries by opaque per-process ids and can never supply a path.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub const MAX_RECENT: usize = 500;
pub const MAX_PINS: usize = 64;
pub const MAX_SEEN: usize = 5_000;
pub const SCAN_DEPTH: usize = 8;
pub const SCAN_FILES: usize = 5_000;
/// Directories one scan may read, and how long it may run: a pinned drive root or a huge tree
/// with few Markdown files stops here instead of walking on in a blocking task.
pub const SCAN_DIRS: usize = 10_000;
pub const SCAN_TIME: Duration = Duration::from_secs(5);
const SKIPPED: [&str; 6] = ["node_modules", ".git", "target", "dist", "build", ".venv"];
/// Folders whose data files the Library lists as agent data (D5).
const AGENT_FOLDERS: [&str; 3] = [".claude", ".codex", ".agent-harness"];

/// A data file the Library lists (Readable data D5): one with a data extension inside an agent
/// folder anywhere in the project, or the project's root `.mcp.json`. Other data files stay out.
pub fn is_agent_data(relative: &Path) -> bool {
    let data = relative
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| {
            crate::file_policy::DATA_EXTENSIONS
                .iter()
                .any(|d| e.eq_ignore_ascii_case(d))
        });
    let folder = relative.parent().is_some_and(|parent| {
        parent.components().any(|c| {
            let name = c.as_os_str().to_string_lossy();
            AGENT_FOLDERS.iter().any(|f| name.eq_ignore_ascii_case(f))
        })
    });
    // Credential stores are never listed: one click from the panel is one too few.
    let secret = relative.file_name().is_some_and(|n| {
        let n = n.to_string_lossy();
        ["auth.json", ".credentials.json", "credentials.json"]
            .iter()
            .any(|s| n.eq_ignore_ascii_case(s))
    });
    data && !secret && (folder || relative.to_string_lossy().eq_ignore_ascii_case(".mcp.json"))
}

/// `.claude/worktrees/` holds whole repository checkouts; the scan never walks into them.
fn is_nested_checkouts(dir: &Path) -> bool {
    let named = |p: &Path, n: &str| {
        p.file_name()
            .is_some_and(|f| f.to_string_lossy().eq_ignore_ascii_case(n))
    };
    named(dir, "worktrees") && dir.parent().is_some_and(|parent| named(parent, ".claude"))
}
const STORE_VERSION: u32 = 1;

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stamped {
    pub path: PathBuf,
    pub at: u64,
}

/// The on-disk shape. Unknown fields are ignored; a bad file is set aside.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Store {
    pub version: u32,
    pub recent: Vec<Stamped>,
    pub pinned_files: Vec<Stamped>,
    pub projects: Vec<Stamped>,
    pub seen: Vec<Stamped>,
    /// The bound files open when the app last changed its open set (S7), in order.
    pub session: Vec<Stamped>,
    /// "Reopen last session on launch" is on unless this is set.
    pub restore_off: bool,
}

/// The case-folded identity of a path (Windows paths compare case-insensitively).
pub fn seen_key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

fn same(a: &Path, b: &Path) -> bool {
    seen_key(a) == seen_key(b)
}

/// `serde_json` refuses a path that is not valid Unicode (an unpaired UTF-16 surrogate in a
/// Windows name), which would fail every save. Such a path is never stored.
fn storable(path: &Path) -> bool {
    path.to_str().is_some()
}

fn upsert(list: &mut Vec<Stamped>, path: &Path, at: u64, cap: usize) {
    if !storable(path) {
        return;
    }
    list.retain(|entry| !same(&entry.path, path));
    list.insert(
        0,
        Stamped {
            path: path.to_path_buf(),
            at,
        },
    );
    list.truncate(cap);
}

impl Store {
    pub fn opened(&mut self, path: &Path, at: u64) {
        upsert(&mut self.recent, path, at, MAX_RECENT);
    }
    pub fn pin_file(&mut self, path: &Path, at: u64) -> bool {
        if !storable(path)
            || (self.pinned_files.len() >= MAX_PINS
                && !self.pinned_files.iter().any(|e| same(&e.path, path)))
        {
            return false;
        }
        upsert(&mut self.pinned_files, path, at, MAX_PINS);
        true
    }
    pub fn pin_project(&mut self, path: &Path, at: u64) -> bool {
        if !storable(path) || !crate::file_policy::is_local_file_path(path) {
            return false;
        }
        if self.projects.len() >= MAX_PINS && !self.projects.iter().any(|e| same(&e.path, path)) {
            return false;
        }
        upsert(&mut self.projects, path, at, MAX_PINS);
        true
    }
    pub fn unpin(&mut self, path: &Path) {
        self.pinned_files.retain(|e| !same(&e.path, path));
        self.projects.retain(|e| !same(&e.path, path));
    }
    pub fn forget(&mut self, path: &Path) {
        self.recent.retain(|e| !same(&e.path, path));
    }
    pub fn mark_seen(&mut self, path: &Path, at: u64) {
        upsert(&mut self.seen, path, at, MAX_SEEN);
    }
    /// Stamp every path as seen at `at`; the same as `mark_seen` for each, in one pass.
    pub fn mark_seen_many(&mut self, paths: &[PathBuf], at: u64) {
        let mut unique = HashSet::new();
        let fresh: Vec<Stamped> = paths
            .iter()
            .filter(|path| storable(path) && unique.insert(seen_key(path)))
            .map(|path| Stamped {
                path: path.clone(),
                at,
            })
            .collect();
        self.seen.retain(|e| !unique.contains(&seen_key(&e.path)));
        self.seen.splice(0..0, fresh);
        self.seen.truncate(MAX_SEEN);
    }
    /// Every seen stamp by `seen_key`, built once so a scan looks files up in O(1).
    pub fn seen_map(&self) -> HashMap<String, u64> {
        self.seen
            .iter()
            .map(|e| (seen_key(&e.path), e.at))
            .collect()
    }
    /// Forget every path; the reopen-on-launch preference is kept.
    pub fn clear(&mut self) {
        *self = Store {
            restore_off: self.restore_off,
            ..Store::default()
        };
    }

    /// Replace the remembered session with these files (32 at most, like a session).
    pub fn record_session(&mut self, paths: &[PathBuf], at: u64) {
        let mut unique = HashSet::new();
        self.session = paths
            .iter()
            .filter(|path| storable(path) && unique.insert(seen_key(path)))
            .take(crate::file_policy::MAX_BATCH_FILES)
            .map(|path| Stamped {
                path: path.clone(),
                at,
            })
            .collect();
    }

    /// The files to reopen on launch, minus any already open.
    pub fn session_to_restore(&self, open: &[PathBuf]) -> Vec<PathBuf> {
        if self.restore_off {
            return Vec::new();
        }
        self.session
            .iter()
            .map(|entry| entry.path.clone())
            .filter(|path| !open.iter().any(|o| same(o, path)))
            .collect()
    }

    /// Drop anything that is not an absolute local drive path, and re-apply caps.
    fn sanitize(mut self) -> Self {
        let keep =
            |e: &Stamped| storable(&e.path) && crate::file_policy::is_local_file_path(&e.path);
        for (list, cap) in [
            (&mut self.recent, MAX_RECENT),
            (&mut self.pinned_files, MAX_PINS),
            (&mut self.projects, MAX_PINS),
            (&mut self.seen, MAX_SEEN),
            (&mut self.session, crate::file_policy::MAX_BATCH_FILES),
        ] {
            list.retain(keep);
            let mut unique = HashSet::new();
            list.retain(|e| unique.insert(e.path.to_string_lossy().to_lowercase()));
            list.truncate(cap);
        }
        self.version = STORE_VERSION;
        self
    }
}

/// Load the store and whether it may be written back. A missing file is an
/// empty, writable library. An invalid one is renamed aside
/// (`library.json.corrupt-<ms>`) and replaced by an empty library. A file that
/// cannot be read right now (locked, access denied) or set aside yields a
/// read-only session, so it is never overwritten with an empty library.
pub fn load(path: &Path) -> (Store, bool) {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return (Store::default().sanitize(), true)
        }
        Err(_) => return (Store::default().sanitize(), false),
    };
    match serde_json::from_slice::<Store>(&bytes) {
        Ok(store) if store.version <= STORE_VERSION => (store.sanitize(), true),
        _ => {
            let aside = path.with_extension(format!("json.corrupt-{}", now_ms()));
            let writable = fs::rename(path, aside).is_ok();
            (Store::default().sanitize(), writable)
        }
    }
}

/// Remove set-aside and leftover temporary library files (they hold paths).
pub fn remove_leftovers(path: &Path) {
    let (Some(dir), Some(name)) = (path.parent(), path.file_name()) else {
        return;
    };
    let corrupt = format!("{}.corrupt-", name.to_string_lossy());
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let file = entry.file_name().to_string_lossy().into_owned();
        if file.starts_with(&corrupt) || file.starts_with(".library-") {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Write the store beside itself and atomically replace it.
pub fn save(path: &Path, store: &Store) -> std::io::Result<()> {
    let parent = path.parent().ok_or(std::io::ErrorKind::InvalidInput)?;
    fs::create_dir_all(parent)?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".library-")
        .tempfile_in(parent)?;
    temporary.write_all(&serde_json::to_vec_pretty(store).map_err(std::io::Error::other)?)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    Ok(())
}

/// What an agentic-development reader cares about in a project.
pub fn is_agent_file(relative: &Path) -> bool {
    let name = relative
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let parent = relative
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let grandparent = relative
        .parent()
        .and_then(Path::parent)
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    matches!(
        name.as_str(),
        "claude.md"
            | "agents.md"
            | "skill.md"
            | "memory.md"
            | "human_todo.md"
            | "action_items.md"
            | "orchestrator.md"
    ) || (parent == "agents" && grandparent == ".claude")
        || parent == "memory"
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ScannedFile {
    pub path: PathBuf,
    pub relative: String,
    pub modified: u64,
    pub agent: bool,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Scan {
    pub files: Vec<ScannedFile>,
    /// True when the depth, file, directory or time bound stopped the walk early.
    pub truncated: bool,
}

#[cfg(windows)]
fn is_reparse(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}
#[cfg(not(windows))]
fn is_reparse(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
}

/// Bounded walk (depth, files, directories, time) of a project folder for Markdown files and agent data files (`is_agent_data`).
/// Never follows a junction, symlink or other reparse point; skips build/dependency folders and
/// the checkouts under `.claude/worktrees/`; includes dot-folders such as `.claude`.
pub fn scan(root: &Path) -> Scan {
    scan_with(root, SCAN_DIRS, Instant::now() + SCAN_TIME, Instant::now)
}

fn scan_with(root: &Path, max_dirs: usize, deadline: Instant, now: impl Fn() -> Instant) -> Scan {
    let mut scan = Scan::default();
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    let mut dirs = 0usize;
    'walk: while let Some((dir, depth)) = stack.pop() {
        if dirs >= max_dirs || now() >= deadline {
            scan.truncated = true;
            break;
        }
        dirs += 1;
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            // A huge flat folder must not outlast the deadline either (Codex on #320).
            if now() >= deadline {
                scan.truncated = true;
                break 'walk;
            }
            let path = entry.path();
            let Ok(metadata) = fs::symlink_metadata(&path) else {
                continue;
            };
            if is_reparse(&metadata) {
                continue;
            }
            if metadata.is_dir() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if SKIPPED.contains(&name.as_str()) || is_nested_checkouts(&path) {
                    continue;
                }
                if depth + 1 >= SCAN_DEPTH {
                    scan.truncated = true;
                    continue;
                }
                stack.push((path, depth + 1));
            } else if metadata.is_file()
                && (is_markdown(&path) || is_agent_data(path.strip_prefix(root).unwrap_or(&path)))
            {
                if scan.files.len() >= SCAN_FILES {
                    scan.truncated = true;
                    stack.clear();
                    break;
                }
                let relative = path.strip_prefix(root).unwrap_or(&path).to_path_buf();
                scan.files.push(ScannedFile {
                    agent: is_agent_file(&relative) || is_agent_data(&relative),
                    relative: relative.to_string_lossy().into_owned(),
                    modified: metadata
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0),
                    path,
                });
            }
        }
    }
    scan.files
        .sort_by_key(|file| std::cmp::Reverse(file.modified));
    scan
}

/// Templates fill a new note once (A4), so a smaller cap than documents.
pub const MAX_TEMPLATE_BYTES: u64 = 1_000_000;

/// The pinned project whose `templates/` folder directly holds `path`, if it is a Markdown file.
fn template_project<'a>(projects: &'a [Stamped], path: &Path) -> Option<&'a Path> {
    let folder = path.parent()?;
    let named = folder
        .file_name()?
        .to_str()?
        .eq_ignore_ascii_case("templates");
    let root = folder.parent()?;
    (named && is_markdown(path))
        .then(|| {
            projects
                .iter()
                .map(|p| p.path.as_path())
                .find(|p| same(p, root))
        })
        .flatten()
}

/// Read a pinned project's template (name, text) with no side effect: no binding, watcher,
/// Recent entry or seen mark, and nothing written. Only a Markdown file directly inside a
/// pinned project's `templates/` folder qualifies; neither that folder nor the file may be a
/// junction, symlink or other reparse point; the usual local-path and encoding rules apply,
/// with a 1 MB cap (`MAX_TEMPLATE_BYTES`).
pub fn read_template(projects: &[Stamped], path: &Path) -> Result<(String, String), String> {
    template_project(projects, path).ok_or("This is not a template of a pinned project.")?;
    for part in [path.parent().unwrap_or(path), path] {
        match fs::symlink_metadata(part) {
            // The template's own cap, stated as such (the reader's message names 25 MB).
            Ok(metadata) if metadata.is_file() && metadata.len() > MAX_TEMPLATE_BYTES => {
                return Err("This template is larger than 1 MB.".into());
            }
            Ok(metadata) if !is_reparse(&metadata) => {}
            Ok(_) => {
                return Err("This template goes through a folder shortcut and is not read.".into())
            }
            Err(_) => return Err("This template could not be read.".into()),
        }
    }
    let document = crate::file_policy::read_markdown(
        path,
        MAX_TEMPLATE_BYTES,
        crate::registry::capture_revision,
    )
    .map_err(|error| error.message)?;
    Ok((document.name, document.text))
}

/// Opaque, stable-per-process ids for library paths. The webview only ever
/// sends these back; it never sends a path.
#[derive(Default)]
pub struct Ids {
    by_id: HashMap<String, PathBuf>,
    by_path: HashMap<String, String>,
    next: u64,
}

impl Ids {
    pub fn id(&mut self, path: &Path) -> String {
        let key = path.to_string_lossy().to_lowercase();
        if let Some(id) = self.by_path.get(&key) {
            return id.clone();
        }
        self.next += 1;
        let id = format!("l{}", self.next);
        self.by_path.insert(key, id.clone());
        self.by_id.insert(id.clone(), path.to_path_buf());
        id
    }
    pub fn path(&self, id: &str) -> Option<&Path> {
        self.by_id.get(id).map(PathBuf::as_path)
    }
    /// Forget every id, but never reuse one: a stale panel row cannot reach a new path.
    pub fn clear(&mut self) {
        self.by_id.clear();
        self.by_path.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn abs(dir: &tempfile::TempDir, name: &str) -> PathBuf {
        dir.path().join(name)
    }

    #[test]
    fn store_caps_dedupes_and_keeps_only_paths_and_timestamps() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::default();
        for n in 0..(MAX_RECENT + 20) {
            store.opened(&abs(&dir, &format!("{n}.md")), n as u64);
        }
        store.opened(&abs(&dir, "5.MD"), 9_999); // Same file, different case: moves to front.
        assert_eq!(store.recent.len(), MAX_RECENT);
        assert_eq!(store.recent[0].at, 9_999);
        for n in 0..(MAX_PINS + 1) {
            let pinned = store.pin_file(&abs(&dir, &format!("p{n}.md")), 1);
            assert_eq!(pinned, n < MAX_PINS);
        }
        let file = dir.path().join("library.json");
        save(&file, &store).unwrap();
        let text = String::from_utf8(fs::read(&file).unwrap()).unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        let mut keys: Vec<_> = value.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(
            keys,
            [
                "pinned_files",
                "projects",
                "recent",
                "restore_off",
                "seen",
                "session",
                "version"
            ]
        );
        for entry in value["recent"].as_array().unwrap() {
            let mut fields: Vec<_> = entry.as_object().unwrap().keys().cloned().collect();
            fields.sort();
            assert_eq!(fields, ["at", "path"], "nothing but a path and a timestamp");
        }
        assert_eq!(load(&file), (store.clone().sanitize(), true));
        store.clear();
        assert_eq!(store, Store::default());
    }

    /// A path `serde_json` cannot write: an unpaired UTF-16 surrogate (Windows) or invalid UTF-8.
    fn unwritable(dir: &tempfile::TempDir) -> PathBuf {
        #[cfg(windows)]
        let name = {
            use std::os::windows::ffi::OsStringExt;
            std::ffi::OsString::from_wide(&[0x61, 0xD800, 0x2E, 0x6D, 0x64])
        };
        #[cfg(unix)]
        let name = {
            use std::os::unix::ffi::OsStringExt;
            std::ffi::OsString::from_vec(vec![0x61, 0xFF, 0x2E, 0x6D, 0x64])
        };
        dir.path().join(name)
    }

    #[test]
    fn a_path_json_cannot_write_is_never_stored_so_saving_keeps_working() {
        let dir = tempfile::tempdir().unwrap();
        let (bad, good) = (unwritable(&dir), abs(&dir, "good.md"));
        assert!(bad.to_str().is_none());
        let mut store = Store::default();
        store.opened(&bad, 1);
        store.mark_seen(&bad, 1);
        assert!(!store.pin_file(&bad, 1));
        assert!(!store.pin_project(&bad, 1));
        store.record_session(&[bad.clone(), good.clone()], 1);
        store.opened(&good, 2);
        let file = dir.path().join("library.json");
        save(&file, &store).expect("the library still persists");
        assert_eq!(load(&file).0.recent.len(), 1);
        assert_eq!(store.session.len(), 1);
        assert!(store.seen.is_empty() && store.pinned_files.is_empty());
        // A store that somehow holds one (an old build) is cleaned on load, not left unsavable.
        store.recent.push(Stamped { path: bad, at: 3 });
        assert!(store
            .sanitize()
            .recent
            .iter()
            .all(|e| e.path.to_str().is_some()));
    }

    #[test]
    fn mark_seen_many_stamps_every_path_once_dedupes_and_keeps_the_cap() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::default();
        store.mark_seen(&abs(&dir, "old.md"), 1);
        store.mark_seen(&abs(&dir, "keep.md"), 2);
        store.mark_seen_many(
            &[
                abs(&dir, "a.md"),
                abs(&dir, "OLD.md"),
                abs(&dir, "A.MD"),
                unwritable(&dir),
            ],
            9,
        );
        let seen = store.seen_map();
        assert_eq!(seen.len(), 3, "{seen:?}");
        assert_eq!(seen.get(&seen_key(&abs(&dir, "a.md"))), Some(&9));
        assert_eq!(seen.get(&seen_key(&abs(&dir, "old.md"))), Some(&9));
        assert_eq!(seen.get(&seen_key(&abs(&dir, "keep.md"))), Some(&2));
        let many: Vec<_> = (0..MAX_SEEN + 5)
            .map(|n| abs(&dir, &format!("{n}.md")))
            .collect();
        store.mark_seen_many(&many, 10);
        assert_eq!(store.seen.len(), MAX_SEEN);
    }

    #[test]
    fn seen_map_answers_like_a_case_folding_lookup_without_scanning() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::default();
        store.mark_seen(&abs(&dir, "Notes.MD"), 7);
        store.mark_seen(&abs(&dir, "b.md"), 9);
        store.mark_seen(&abs(&dir, "notes.md"), 11); // Same file: the later stamp wins.
        let seen = store.seen_map();
        assert_eq!(seen.len(), 2);
        assert_eq!(seen.get(&seen_key(&abs(&dir, "NOTES.md"))), Some(&11));
        assert_eq!(seen.get(&seen_key(&abs(&dir, "B.md"))), Some(&9));
        assert_eq!(seen.get(&seen_key(&abs(&dir, "c.md"))), None);
    }

    #[test]
    fn the_session_keeps_open_bound_files_in_order_and_survives_clear_preferences() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (abs(&dir, "a.md"), abs(&dir, "b.md"));
        let mut store = Store::default();
        store.record_session(&[a.clone(), b.clone(), abs(&dir, "A.MD")], 5);
        assert_eq!(store.session_to_restore(&[]), [a.clone(), b.clone()]);
        assert_eq!(
            store.session_to_restore(&[abs(&dir, "B.md")]),
            std::slice::from_ref(&a),
            "already open files are skipped"
        );
        let file = dir.path().join("library.json");
        save(&file, &store).unwrap();
        assert_eq!(load(&file).0.session, store.session);
        store.restore_off = true;
        assert!(store.session_to_restore(&[]).is_empty());
        store.clear();
        assert!(
            store.session.is_empty() && store.restore_off,
            "Clear forgets paths, keeps the preference"
        );
        let many: Vec<_> = (0..40).map(|n| abs(&dir, &format!("{n}.md"))).collect();
        store.record_session(&many, 1);
        assert_eq!(store.session.len(), crate::file_policy::MAX_BATCH_FILES);
    }

    #[test]
    fn a_corrupt_store_is_set_aside_and_replaced_by_an_empty_library() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("library.json");
        fs::write(&file, b"{ not json").unwrap();
        assert_eq!(load(&file), (Store::default().sanitize(), true));
        assert!(!file.exists());
        let aside: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(
            aside.iter().any(|n| n.starts_with("library.json.corrupt-")),
            "{aside:?}"
        );
        // Relative or future-version entries never load.
        fs::write(&file, br#"{"version":1,"recent":[{"path":"relative.md","at":1},{"path":"\\\\host\\share\\a.md","at":2}]}"#).unwrap();
        assert!(
            load(&file).0.recent.is_empty(),
            "relative and network paths never load"
        );
        fs::write(&file, br#"{"version":99}"#).unwrap();
        assert_eq!(load(&file), (Store::default().sanitize(), true));
        // A store that cannot be read right now is left alone and never overwritten.
        // (The future-version file above was set aside, so the name is free.)
        fs::create_dir(&file).unwrap();
        assert!(
            !load(&file).1,
            "an unreadable store makes the session read-only"
        );
        remove_leftovers(&file);
        let left: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(left, ["library.json"], "Clear removes set-aside copies");
    }

    #[test]
    fn scan_is_bounded_skips_build_folders_includes_dot_folders_and_classifies_agent_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for rel in [
            "README.md",
            "CLAUDE.md",
            ".claude/agents/reviewer.md",
            ".claude/skills/ship/SKILL.md",
            "docs/memory/note.md",
            "src/notes.markdown",
            "src/code.rs",
            "node_modules/pkg/README.md",
            ".git/info.md",
            "target/doc.md",
        ] {
            let path = root.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, b"x").unwrap();
        }
        let mut deep = root.to_path_buf();
        for level in 0..(SCAN_DEPTH + 2) {
            deep = deep.join(format!("d{level}"));
        }
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("too-deep.md"), b"x").unwrap();
        let scan = scan(root);
        let mut found: Vec<_> = scan
            .files
            .iter()
            .map(|f| (f.relative.replace('\\', "/"), f.agent))
            .collect();
        found.sort();
        assert_eq!(
            found,
            [
                (".claude/agents/reviewer.md".into(), true),
                (".claude/skills/ship/SKILL.md".into(), true),
                ("CLAUDE.md".into(), true),
                ("README.md".into(), false),
                ("docs/memory/note.md".into(), true),
                ("src/notes.markdown".into(), false),
            ]
        );
        assert!(scan.truncated, "the depth bound is reported");
    }

    #[test]
    fn scan_stops_at_the_file_bound() {
        let dir = tempfile::tempdir().unwrap();
        for n in 0..(SCAN_FILES + 5) {
            fs::write(dir.path().join(format!("{n}.md")), b"").unwrap();
        }
        let scan = scan(dir.path());
        assert_eq!(scan.files.len(), SCAN_FILES);
        assert!(scan.truncated);
    }

    #[test]
    fn scan_stops_at_the_directory_and_time_bounds_and_reports_it() {
        let dir = tempfile::tempdir().unwrap();
        for n in 0..20 {
            fs::create_dir(dir.path().join(format!("empty{n}"))).unwrap();
        }
        fs::write(dir.path().join("a.md"), b"x").unwrap();
        let far = Instant::now() + Duration::from_secs(3_600);
        let all = scan_with(dir.path(), usize::MAX, far, Instant::now);
        assert!(!all.truncated && all.files.len() == 1, "{all:?}");
        let few = scan_with(dir.path(), 5, far, Instant::now);
        assert!(few.truncated, "the directory bound is reported");
        let late = scan_with(dir.path(), usize::MAX, Instant::now(), Instant::now);
        assert!(late.truncated, "a passed deadline is reported");
    }

    #[test]
    fn the_deadline_also_stops_a_walk_inside_one_large_folder() {
        let dir = tempfile::tempdir().unwrap();
        for n in 0..50 {
            fs::write(dir.path().join(format!("note{n}.md")), b"x").unwrap();
        }
        // The clock passes the deadline after the root is entered, while its entries are listed.
        let start = Instant::now();
        let calls = std::cell::Cell::new(0u32);
        let clock = || {
            calls.set(calls.get() + 1);
            if calls.get() <= 3 {
                start
            } else {
                start + Duration::from_secs(10)
            }
        };
        let scan = scan_with(
            dir.path(),
            usize::MAX,
            start + Duration::from_secs(5),
            clock,
        );
        assert!(scan.truncated, "the deadline inside a folder is reported");
        assert!(
            scan.files.len() < 50,
            "the walk stopped early: {}",
            scan.files.len()
        );
    }

    #[cfg(windows)]
    #[test]
    fn scan_never_follows_a_junction() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.md"), b"x").unwrap();
        let link = dir.path().join("linked");
        let status = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&link)
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(status.status.success(), "{status:?}");
        fs::write(dir.path().join("mine.md"), b"x").unwrap();
        let files: Vec<_> = scan(dir.path())
            .files
            .into_iter()
            .map(|f| f.relative)
            .collect();
        assert_eq!(files, ["mine.md"]);
        fs::remove_dir(&link).unwrap(); // Removes the junction only.
    }

    #[test]
    fn ids_are_opaque_and_stable_per_path() {
        let mut ids = Ids::default();
        let a = ids.id(Path::new(r"C:\notes\a.md"));
        assert_eq!(ids.id(Path::new(r"c:\NOTES\a.md")), a);
        assert_ne!(ids.id(Path::new(r"C:\notes\b.md")), a);
        assert_eq!(ids.path(&a), Some(Path::new(r"C:\notes\a.md")));
        assert!(!a.contains("notes"));
        assert_eq!(ids.path("l999"), None);
        ids.clear();
        assert_eq!(ids.path(&a), None);
        assert_ne!(
            ids.id(Path::new(r"C:\other.md")),
            a,
            "ids are never reused after Clear"
        );
    }

    fn pinned(root: &Path) -> Vec<Stamped> {
        vec![Stamped {
            path: root.to_path_buf(),
            at: 1,
        }]
    }

    #[test]
    fn reads_a_pinned_projects_template_and_nothing_else() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("templates").join("sub")).unwrap();
        fs::write(
            root.join("templates").join("Run card.md"),
            "# {{title}}\r\n- [ ] step\r\n",
        )
        .unwrap();
        let (name, text) =
            read_template(&pinned(root), &root.join("templates").join("Run card.md")).unwrap();
        assert_eq!(
            (name.as_str(), text.as_str()),
            ("Run card.md", "# {{title}}\r\n- [ ] step\r\n")
        );
        // The folder name matches case-insensitively, like Windows.
        let upper = tempfile::tempdir().unwrap();
        fs::create_dir_all(upper.path().join("TEMPLATES")).unwrap();
        fs::write(upper.path().join("TEMPLATES").join("t.MD"), "x").unwrap();
        assert!(read_template(
            &pinned(upper.path()),
            &upper.path().join("TEMPLATES").join("t.MD")
        )
        .is_ok());
        fs::create_dir_all(root.join("other").join("TEMPLATES")).unwrap();
        // Outside templates/, nested below it, not Markdown, or in an unpinned project: refused.
        fs::write(root.join("note.md"), "x").unwrap();
        fs::write(root.join("templates").join("sub").join("deep.md"), "x").unwrap();
        fs::write(root.join("templates").join("data.json"), "{}").unwrap();
        fs::write(root.join("other").join("TEMPLATES").join("nested.md"), "x").unwrap();
        for path in [
            root.join("note.md"),
            root.join("templates").join("sub").join("deep.md"),
            root.join("templates").join("data.json"),
            root.join("other").join("TEMPLATES").join("nested.md"),
        ] {
            assert!(read_template(&pinned(root), &path).is_err(), "{path:?}");
        }
        assert!(read_template(&[], &root.join("templates").join("Run card.md")).is_err());
        // Over the 1 MB cap.
        fs::write(
            root.join("templates").join("big.md"),
            vec![b'a'; MAX_TEMPLATE_BYTES as usize + 1],
        )
        .unwrap();
        assert_eq!(
            read_template(&pinned(root), &root.join("templates").join("big.md")).unwrap_err(),
            "This template is larger than 1 MB."
        );
    }

    #[cfg(windows)]
    #[test]
    fn never_reads_a_template_through_a_junction() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.md"), "x").unwrap();
        let link = dir.path().join("templates");
        let status = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&link)
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(status.status.success(), "{status:?}");
        let error = read_template(&pinned(dir.path()), &link.join("secret.md")).unwrap_err();
        assert!(error.contains("folder shortcut"), "{error}");
        fs::remove_dir(&link).unwrap(); // Removes the junction only.
    }

    #[test]
    fn scan_lists_agent_data_files_and_never_walks_nested_worktrees() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for (path, text) in [
            ("notes.md", "x"),
            (".claude/settings.json", "{}"),
            (".claude/projects/run.jsonl", "{}"),
            (".codex/config.toml", "a = 1"),
            (".agent-harness/tier.json", "{}"),
            (".mcp.json", "{}"),
            ("data/config.json", "{}"),
            ("src/.mcp.json", "{}"),
            (".claude/worktrees/copy/README.md", "x"),
            (".claude/worktrees/copy/.claude/settings.json", "{}"),
            (".git/config.json", "{}"),
            ("node_modules/pkg/.claude/x.json", "{}"),
            (".codex/auth.json", "{}"),
            (".claude/.credentials.json", "{}"),
            (".CLAUDE/Worktrees/copy2/notes.md", "x"),
        ] {
            let path = root.join(path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, text).unwrap();
        }
        let scan = scan(root);
        let mut files: Vec<(String, bool)> = scan
            .files
            .into_iter()
            .map(|f| (f.relative.replace('\\', "/"), f.agent))
            .collect();
        files.sort();
        assert_eq!(
            files,
            [
                (".agent-harness/tier.json".to_string(), true),
                (".claude/projects/run.jsonl".to_string(), true),
                (".claude/settings.json".to_string(), true),
                (".codex/config.toml".to_string(), true),
                (".mcp.json".to_string(), true),
                ("notes.md".to_string(), false),
            ]
        );
    }
}
