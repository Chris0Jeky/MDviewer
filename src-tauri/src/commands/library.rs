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
    store: Store,
    ids: Ids,
}

impl Library {
    fn load(file: Option<PathBuf>) -> Self {
        let store = file.as_deref().map(library::load).unwrap_or_default();
        Self {
            file,
            store,
            ids: Ids::default(),
        }
    }
    fn persist(&self) {
        if let Some(file) = &self.file {
            // A failed write keeps the in-memory library; the next change retries.
            let _ = library::save(file, &self.store);
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

/// Record successful opens and saves as recent files.
pub(crate) fn remember(app: &AppHandle, paths: impl IntoIterator<Item = PathBuf>) {
    let at = library::now_ms();
    with_library(app, |library| {
        let mut changed = false;
        for path in paths {
            library.store.opened(&path, at);
            changed = true;
        }
        if changed {
            library.persist();
        }
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
            .any(|p| p.path == path)
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
            library.persist();
        });
    }
    Ok(batch)
}

fn mutate(app: &AppHandle, act: impl FnOnce(&mut Store, u64) -> bool) -> bool {
    let at = library::now_ms();
    with_library(app, |library| {
        let changed = act(&mut library.store, at);
        if changed {
            library.persist();
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
pub(crate) fn library_clear(app: AppHandle) {
    with_library(&app, |library| {
        library.store.clear();
        library.ids.clear();
        library.persist();
    });
}

pub(crate) type LibrarySlot = Mutex<Option<Library>>;
