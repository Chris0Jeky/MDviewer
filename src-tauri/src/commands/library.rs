//! Library IPC (companion push S4, native half). The panel lists entries by
//! opaque id, opens through `library_open(id)`, and pins folders only through the
//! native folder picker. Display paths go to the webview; paths never come back.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::commands::open::OpenBatch;
use crate::file_policy::read_batch;
use crate::library::{self, Ids, Store};
use crate::registry::{capture_revision, Token};
use crate::DesktopState;

/// Loaded on first use, so reading a file never touches the library store.
pub(crate) struct Library {
    file: Option<PathBuf>,
    /// False when the store could not be read safely this session.
    writable: bool,
    store: Store,
    ids: Ids,
}

impl Library {
    fn load(file: Option<PathBuf>) -> Self {
        let (store, writable) = file.as_deref().map(library::load).unwrap_or_default();
        Self {
            file,
            writable,
            store,
            ids: Ids::default(),
        }
    }
    fn persist(&self) -> bool {
        match &self.file {
            // A failed write keeps the in-memory library; the next change retries.
            Some(file) if self.writable => library::save(file, &self.store).is_ok(),
            _ => false,
        }
    }
}

pub(crate) fn with_library<T>(app: &AppHandle, act: impl FnOnce(&mut Library) -> T) -> T {
    let state = app.state::<DesktopState>();
    let mut slot = state
        .library
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let library = slot.get_or_insert_with(|| {
        Library::load(
            app.path()
                .app_local_data_dir()
                .ok()
                .map(|dir| dir.join("library.json")),
        )
    });
    act(library)
}

/// Record successful opens and saves as recent files. Runs off the open path:
/// the first paint never waits for the library to load or write.
pub(crate) fn remember(app: &AppHandle, paths: impl IntoIterator<Item = PathBuf>) {
    let paths: Vec<PathBuf> = paths.into_iter().collect();
    if paths.is_empty() {
        return;
    }
    let app = app.clone();
    let at = library::now_ms();
    tauri::async_runtime::spawn_blocking(move || {
        with_library(&app, |library| {
            for path in &paths {
                library.store.opened(path, at);
            }
            let _ = library.persist();
        });
    });
}

#[derive(Serialize)]
pub(crate) struct Entry {
    id: String,
    name: String,
    dir: String,
    path: String,
    at: u64,
}

fn entry(ids: &mut Ids, path: &Path, at: u64) -> Entry {
    Entry {
        id: ids.id(path),
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        dir: path
            .parent()
            .map(|d| d.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        at,
    }
}

#[derive(Serialize)]
pub(crate) struct LibraryView {
    recent: Vec<Entry>,
    pinned: Vec<Entry>,
    projects: Vec<Entry>,
}

#[tauri::command]
pub(crate) fn library_list(app: AppHandle) -> LibraryView {
    with_library(&app, |library| {
        let Library { store, ids, .. } = library;
        let list = |ids: &mut Ids, items: &[library::Stamped]| {
            items.iter().map(|e| entry(ids, &e.path, e.at)).collect()
        };
        LibraryView {
            recent: list(ids, &store.recent),
            pinned: list(ids, &store.pinned_files),
            projects: list(ids, &store.projects),
        }
    })
}

#[derive(Serialize)]
pub(crate) struct ProjectFile {
    id: String,
    name: String,
    relative: String,
    path: String,
    modified: u64,
    agent: bool,
    /// Changed since this file was last opened from the library or marked seen.
    unseen: bool,
}

#[derive(Serialize)]
pub(crate) struct ProjectScan {
    files: Vec<ProjectFile>,
    truncated: bool,
}

#[tauri::command]
pub(crate) async fn library_scan(app: AppHandle, id: String) -> Result<ProjectScan, String> {
    let root = with_library(&app, |library| {
        let path = library.ids.path(&id)?.to_path_buf();
        library
            .store
            .projects
            .iter()
            .any(|p| {
                p.path.to_string_lossy().to_lowercase() == path.to_string_lossy().to_lowercase()
            })
            .then_some(path)
    })
    .ok_or("This project is no longer in the library.")?;
    let scan = tauri::async_runtime::spawn_blocking(move || library::scan(&root))
        .await
        .map_err(|_| "The project folder could not be listed.".to_string())?;
    Ok(with_library(&app, |library| ProjectScan {
        truncated: scan.truncated,
        files: scan
            .files
            .into_iter()
            .map(|file| ProjectFile {
                unseen: library
                    .store
                    .seen_at(&file.path)
                    .is_none_or(|seen| file.modified > seen),
                id: library.ids.id(&file.path),
                name: file
                    .path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                path: file.path.to_string_lossy().into_owned(),
                relative: file.relative,
                modified: file.modified,
                agent: file.agent,
            })
            .collect(),
    }))
}

/// Open a library entry (recent, pinned or scanned) like a picked file.
#[tauri::command]
pub(crate) async fn library_open(
    app: AppHandle,
    state: State<'_, DesktopState>,
    id: String,
) -> Result<OpenBatch, String> {
    let path = with_library(&app, |library| library.ids.path(&id).map(Path::to_path_buf))
        .ok_or("This library entry is no longer available.")?;
    let read = path.clone();
    let batch = tauri::async_runtime::spawn_blocking(move || read_batch([read], capture_revision))
        .await
        .map_err(|_| "The file could not be read. Try opening it again.".to_string())?;
    let opened = !batch.documents.is_empty();
    let batch = OpenBatch::from_read_batch(
        batch,
        &mut state
            .registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()),
    )
    .follow(&state);
    if opened {
        let at = library::now_ms();
        with_library(&app, |library| {
            library.store.opened(&path, at);
            library.store.mark_seen(&path, at);
            let _ = library.persist();
        });
    }
    Ok(batch)
}

#[derive(Serialize)]
pub(crate) struct TemplateText {
    name: String,
    text: String,
}

/// The id's path and the pinned projects, read without touching the store.
fn template_target(library: &Library, id: &str) -> Option<(PathBuf, Vec<library::Stamped>)> {
    Some((
        library.ids.path(id)?.to_path_buf(),
        library.store.projects.clone(),
    ))
}

/// Read a pinned project's template to fill a new note (A4). Read-only: the id (as `library_scan`
/// hands out) must name a Markdown file directly inside a pinned project's `templates/` folder;
/// nothing is bound, watched, recorded as recent or seen, or written to `library.json`.
#[tauri::command]
pub(crate) async fn library_read_template(
    app: AppHandle,
    id: String,
) -> Result<TemplateText, String> {
    let (path, projects) = with_library(&app, |library| template_target(library, &id))
        .ok_or("This template is no longer available.")?;
    tauri::async_runtime::spawn_blocking(move || library::read_template(&projects, &path))
        .await
        .map_err(|_| "The template could not be read.".to_string())?
        .map(|(name, text)| TemplateText { name, text })
}

fn mutate(app: &AppHandle, act: impl FnOnce(&mut Store, u64) -> bool) -> bool {
    let at = library::now_ms();
    with_library(app, |library| {
        let changed = act(&mut library.store, at);
        if changed {
            let _ = library.persist();
        }
        changed
    })
}

/// Pin an open document by its capability token, or a listed entry by id.
#[tauri::command]
pub(crate) fn library_pin(
    app: AppHandle,
    state: State<'_, DesktopState>,
    token: Option<String>,
    id: Option<String>,
) -> bool {
    let path = match (token.as_deref().and_then(Token::parse), id) {
        (Some(token), _) => state
            .registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&token)
            .map(|binding| binding.path.clone()),
        (None, Some(id)) => with_library(&app, |l| l.ids.path(&id).map(Path::to_path_buf)),
        (None, None) => None,
    };
    path.is_some_and(|path| mutate(&app, |store, at| store.pin_file(&path, at)))
}

#[tauri::command]
pub(crate) fn library_unpin(app: AppHandle, id: String) {
    if let Some(path) = with_library(&app, |l| l.ids.path(&id).map(Path::to_path_buf)) {
        mutate(&app, |store, _| {
            store.unpin(&path);
            true
        });
    }
}

#[tauri::command]
pub(crate) fn library_forget(app: AppHandle, id: String) {
    if let Some(path) = with_library(&app, |l| l.ids.path(&id).map(Path::to_path_buf)) {
        mutate(&app, |store, _| {
            store.forget(&path);
            true
        });
    }
}

#[tauri::command]
pub(crate) fn library_mark_seen(app: AppHandle, id: String) {
    if let Some(path) = with_library(&app, |l| l.ids.path(&id).map(Path::to_path_buf)) {
        mutate(&app, |store, at| {
            store.mark_seen(&path, at);
            true
        });
    }
}

/// Pin a project folder chosen in the native folder picker.
#[tauri::command]
pub(crate) async fn library_add_project(
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<Option<String>, String> {
    if state
        .picker_open
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("A file picker is already open.".into());
    }
    let dialog_app = app.clone();
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        let mut picker = rfd::FileDialog::new().set_title("Pin a project folder");
        if let Some(window) = dialog_app.get_webview_window("main") {
            picker = picker.set_parent(&window);
        }
        picker.pick_folder()
    })
    .await;
    state.picker_open.store(false, Ordering::Release);
    let Some(folder) = chosen.map_err(|_| "The folder picker could not complete.".to_string())?
    else {
        return Ok(None);
    };
    if !folder.is_absolute() {
        return Err("Choose a local folder.".into());
    }
    if !mutate(&app, |store, at| store.pin_project(&folder, at)) {
        return Err("Unpin a project first: at most 64 can be pinned.".into());
    }
    Ok(Some(with_library(&app, |l| l.ids.id(&folder))))
}

/// "Clear library": forget every recent file, pin, project and seen stamp.
#[tauri::command]
pub(crate) fn library_clear(app: AppHandle) -> Result<(), String> {
    with_library(&app, |library| {
        library.store.clear();
        library.ids.clear();
        // Clearing is an explicit request: write even after an unreadable load.
        library.writable = true;
        if let Some(file) = &library.file {
            library::remove_leftovers(file);
        }
        if library.persist() {
            Ok(())
        } else {
            Err(
                "The library file could not be cleared. Check access to the app's data folder."
                    .into(),
            )
        }
    })
}

pub(crate) type LibrarySlot = Mutex<Option<Library>>;

/// Remember which bound files are open (paths only), so the next launch can
/// reopen them. The webview sends tokens; paths come from the registry.
#[tauri::command]
pub(crate) async fn session_record(
    app: AppHandle,
    state: State<'_, DesktopState>,
    tokens: Vec<String>,
) -> Result<(), String> {
    let paths: Vec<PathBuf> = {
        let registry = state
            .registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        tokens
            .iter()
            .filter_map(|token| Token::parse(token))
            .filter_map(|token| registry.get(&token).map(|binding| binding.path.clone()))
            .collect()
    };
    let at = library::now_ms();
    // Awaited, so a record sent while the window closes is on disk before exit.
    tauri::async_runtime::spawn_blocking(move || {
        with_library(&app, |library| {
            // With reopen off, no session is kept at all.
            if library.store.restore_off {
                return;
            }
            library.store.record_session(&paths, at);
            let _ = library.persist();
        });
    })
    .await
    .map_err(|_| "The session could not be recorded.".to_string())
}

/// Reopen the last session's files that are not already open (setting on by default).
#[tauri::command]
pub(crate) async fn session_restore(
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<OpenBatch, String> {
    let (open, free) = {
        let registry = state
            .registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let open = registry.paths();
        // Never restore more files than can stay bound to their capability.
        (
            open,
            crate::file_policy::MAX_BATCH_FILES.saturating_sub(registry.len()),
        )
    };
    let restore = {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            with_library(&app, |library| {
                let mut restore = library.store.session_to_restore(&open);
                restore.truncate(free);
                restore
            })
        })
        .await
        .map_err(|_| "The last session could not be read.".to_string())?
    };
    let batch = tauri::async_runtime::spawn_blocking(move || read_batch(restore, capture_revision))
        .await
        .map_err(|_| "The last session could not be reopened.".to_string())?;
    Ok(OpenBatch::from_read_batch(
        batch,
        &mut state
            .registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()),
    )
    .follow(&state))
}

#[derive(Serialize)]
pub(crate) struct SessionSetting {
    restore: bool,
    /// False when the preference could not be written (it then lasts this run only).
    persisted: bool,
}

/// Read or change "Reopen last session on launch".
#[tauri::command]
pub(crate) fn session_setting(app: AppHandle, restore: Option<bool>) -> SessionSetting {
    with_library(&app, |library| {
        let mut persisted = true;
        if let Some(restore) = restore {
            library.store.restore_off = !restore;
            if !restore {
                library.store.session.clear();
            }
            persisted = library.persist();
        }
        SessionSetting {
            restore: !library.store.restore_off,
            persisted,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reading_a_template_leaves_the_library_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("project");
        fs_write(&project.join("templates").join("t.md"), "# T\n");
        let file = dir.path().join("library.json");
        let mut store = Store::default();
        store.pin_project(&project, 1);
        library::save(&file, &store).unwrap();
        let before = std::fs::read(&file).unwrap();
        let mut library = Library::load(Some(file.clone()));
        let id = library.ids.id(&project.join("templates").join("t.md"));
        let (path, projects) = template_target(&library, &id).unwrap();
        let (name, text) = library::read_template(&projects, &path).unwrap();
        assert_eq!((name.as_str(), text.as_str()), ("t.md", "# T\n"));
        assert_eq!(
            std::fs::read(&file).unwrap(),
            before,
            "library.json is byte-identical"
        );
        assert!(library.store.recent.is_empty() && library.store.seen.is_empty());
        assert_eq!(template_target(&library, "l999"), None);
    }

    fn fs_write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }
}
