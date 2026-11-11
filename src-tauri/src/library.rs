//! The persisted library (companion push S4): recent files, pinned files, pinned
//! project folders and "last looked at" stamps. Only absolute paths and Unix
//! millisecond timestamps are stored — never document content — in
//! `library.json` under the app's local data folder. The webview refers to
//! entries by opaque per-process ids and can never supply a path.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub const MAX_RECENT: usize = 500;
pub const MAX_PINS: usize = 64;
pub const MAX_SEEN: usize = 5_000;
pub const SCAN_DEPTH: usize = 8;
pub const SCAN_FILES: usize = 5_000;
const SKIPPED: [&str; 6] = ["node_modules", ".git", "target", "dist", "build", ".venv"];
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
}

fn same(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
}

fn upsert(list: &mut Vec<Stamped>, path: &Path, at: u64, cap: usize) {
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
        if self.pinned_files.len() >= MAX_PINS
            && !self.pinned_files.iter().any(|e| same(&e.path, path))
        {
            return false;
        }
        upsert(&mut self.pinned_files, path, at, MAX_PINS);
        true
    }
    pub fn pin_project(&mut self, path: &Path, at: u64) -> bool {
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
    pub fn seen_at(&self, path: &Path) -> Option<u64> {
        self.seen.iter().find(|e| same(&e.path, path)).map(|e| e.at)
    }
    pub fn clear(&mut self) {
        *self = Store::default();
    }

    /// Drop anything that is not an absolute local path, and re-apply caps.
    fn sanitize(mut self) -> Self {
        let keep = |e: &Stamped| e.path.is_absolute();
        for (list, cap) in [
            (&mut self.recent, MAX_RECENT),
            (&mut self.pinned_files, MAX_PINS),
            (&mut self.projects, MAX_PINS),
            (&mut self.seen, MAX_SEEN),
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

/// Load the store. A missing file is an empty library; an unreadable or invalid
/// one is renamed aside (`library.json.corrupt-<ms>`) and replaced by an empty
/// library, so a bad file never blocks the app and is never silently destroyed.
pub fn load(path: &Path) -> Store {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(_) => return Store::default().sanitize(),
    };
    match serde_json::from_slice::<Store>(&bytes) {
        Ok(store) if store.version <= STORE_VERSION => store.sanitize(),
        _ => {
            let aside = path.with_extension(format!("json.corrupt-{}", now_ms()));
            let _ = fs::rename(path, aside);
            Store::default().sanitize()
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
    /// True when the depth or file bound stopped the walk early.
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

/// Bounded walk of a project folder for Markdown files. Never follows a
/// junction, symlink or other reparse point; skips build/dependency folders;
/// includes dot-folders such as `.claude`.
pub fn scan(root: &Path) -> Scan {
    let mut scan = Scan::default();
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(metadata) = fs::symlink_metadata(&path) else {
                continue;
            };
            if is_reparse(&metadata) {
                continue;
            }
            if metadata.is_dir() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if SKIPPED.contains(&name.as_str()) {
                    continue;
                }
                if depth + 1 >= SCAN_DEPTH {
                    scan.truncated = true;
                    continue;
                }
                stack.push((path, depth + 1));
            } else if metadata.is_file() && is_markdown(&path) {
                if scan.files.len() >= SCAN_FILES {
                    scan.truncated = true;
                    return scan;
                }
                let relative = path.strip_prefix(root).unwrap_or(&path).to_path_buf();
                scan.files.push(ScannedFile {
                    agent: is_agent_file(&relative),
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
    scan.files.sort_by(|a, b| b.modified.cmp(&a.modified));
    scan
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
    pub fn clear(&mut self) {
        *self = Self::default();
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
            ["pinned_files", "projects", "recent", "seen", "version"]
        );
        for entry in value["recent"].as_array().unwrap() {
            let mut fields: Vec<_> = entry.as_object().unwrap().keys().cloned().collect();
            fields.sort();
            assert_eq!(fields, ["at", "path"], "nothing but a path and a timestamp");
        }
        assert_eq!(load(&file), store.clone().sanitize());
        store.clear();
        assert_eq!(store, Store::default());
    }

    #[test]
    fn a_corrupt_store_is_set_aside_and_replaced_by_an_empty_library() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("library.json");
        fs::write(&file, b"{ not json").unwrap();
        assert_eq!(load(&file).recent.len(), 0);
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
        fs::write(
            &file,
            br#"{"version":1,"recent":[{"path":"relative.md","at":1}]}"#,
        )
        .unwrap();
        assert!(load(&file).recent.is_empty());
        fs::write(&file, br#"{"version":99}"#).unwrap();
        assert_eq!(load(&file), Store::default().sanitize());
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
    }
}
