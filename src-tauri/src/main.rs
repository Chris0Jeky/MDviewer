#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod export_policy;
mod file_policy;

use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Emitter, Manager, State, Url, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

use export_policy::{export_data, export_destination, export_name, export_size, ExportKind};
use file_policy::{read_batch, resolve_launch_paths, skipped_files_error, PendingFiles};

const FILES_PENDING_EVENT: &str = "mdviewer:files-pending";

#[derive(Default)]
struct DesktopState {
    pending: Mutex<PendingFiles>,
    picker_open: AtomicBool,
}

// The webview receives basenames and document text, never filesystem paths. Paths
// can enter the host only from its OS launch arguments or a native file dialog.
#[derive(Serialize)]
struct OpenDocument {
    name: String,
    text: String,
    bytes: u64,
}

#[derive(Serialize)]
struct OpenError {
    name: String,
    message: String,
}

#[derive(Default, Serialize)]
struct OpenBatch {
    documents: Vec<OpenDocument>,
    errors: Vec<OpenError>,
    canceled: bool,
}

impl From<file_policy::ReadBatch> for OpenBatch {
    fn from(batch: file_policy::ReadBatch) -> Self {
        Self {
            documents: batch
                .documents
                .into_iter()
                .map(|doc| OpenDocument {
                    name: doc.name,
                    text: doc.text,
                    bytes: doc.bytes,
                })
                .collect(),
            errors: batch
                .errors
                .into_iter()
                .map(|error| OpenError {
                    name: error.name,
                    message: error.message,
                })
                .collect(),
            canceled: false,
        }
    }
}

#[tauri::command]
async fn open_files(app: AppHandle, state: State<'_, DesktopState>) -> Result<OpenBatch, String> {
    if state
        .picker_open
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("A file picker is already open.".into());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut picker = rfd::FileDialog::new()
            .set_title("Open Markdown")
            .add_filter("Markdown documents", &["md", "markdown"]);
        if let Some(window) = app.get_webview_window("main") {
            picker = picker.set_parent(&window);
        }
        let selected = picker.pick_files();
        let Some(selected) = selected else {
            return OpenBatch {
                canceled: true,
                ..OpenBatch::default()
            };
        };
        OpenBatch::from(read_batch(selected))
    })
    .await;
    state.picker_open.store(false, Ordering::Release);
    result.map_err(|_| "The file picker could not complete. Try opening the file again.".into())
}

#[tauri::command]
async fn take_pending_files(state: State<'_, DesktopState>) -> Result<OpenBatch, String> {
    let pending = {
        let mut queue = state
            .pending
            .lock()
            .map_err(|_| "The file-open queue is unavailable.".to_string())?;
        std::mem::take(&mut *queue)
    };
    tauri::async_runtime::spawn_blocking(move || {
        let mut batch = read_batch(pending.paths);
        if pending.skipped > 0 {
            batch.errors.push(skipped_files_error(pending.skipped));
        }
        OpenBatch::from(batch)
    })
    .await
    .map_err(|_| "The selected files could not be read. Try opening them again.".into())
}

#[derive(Debug, Serialize)]
struct SaveExportResult {
    canceled: bool,
}

fn persist_export(
    selected: Option<std::path::PathBuf>,
    kind: ExportKind,
    bytes: &[u8],
) -> Result<SaveExportResult, String> {
    let Some(destination) = selected else {
        return Ok(SaveExportResult { canceled: true });
    };
    export_destination(&destination, kind).map_err(str::to_owned)?;
    let parent = destination
        .parent()
        .ok_or("Choose a valid export destination.")?;
    // Write beside the chosen destination, then atomically replace it. If writing
    // fails, the previously existing file remains intact and the temp file drops.
    let mut temporary = tempfile::Builder::new()
        .prefix(".mdviewer-export-")
        .tempfile_in(parent)
        .map_err(|_| "The export destination could not be opened. Choose another folder.")?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| "The export could not be written. Check free space and try again.")?;
    temporary.persist(&destination).map_err(|_| {
        "The exported file could not replace the destination. Check access and try again."
    })?;
    Ok(SaveExportResult { canceled: false })
}

#[tauri::command]
async fn save_export(
    app: AppHandle,
    state: State<'_, DesktopState>,
    request: Request<'_>,
) -> Result<SaveExportResult, String> {
    let encoded = request
        .headers()
        .get("x-mdviewer-filename")
        .and_then(|header| header.to_str().ok())
        .filter(|header| header.len() <= 4096)
        .ok_or("The export filename is missing or too long.")?;
    let name = percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .map_err(|_| "The export filename is not valid UTF-8.")?
        .into_owned();
    let kind = export_name(&name).map_err(str::to_owned)?;
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes,
        _ => return Err("The export must be sent as raw bytes.".into()),
    };
    export_size(bytes.len()).map_err(str::to_owned)?;
    export_data(kind, bytes).map_err(str::to_owned)?;
    if state
        .picker_open
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("A file picker is already open.".into());
    }
    // One bounded copy leaves the request borrowed only until the async command
    // returns; no JSON number array or base64 representation is constructed.
    let bytes = bytes.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut picker = rfd::FileDialog::new()
            .set_title("Save export")
            .set_file_name(&name);
        picker = match kind {
            ExportKind::Pdf => picker.add_filter("PDF document", &["pdf"]),
            ExportKind::Markdown => picker.add_filter("Markdown document", &["md", "markdown"]),
        };
        if let Some(window) = app.get_webview_window("main") {
            picker = picker.set_parent(&window);
        }
        persist_export(picker.save_file(), kind, &bytes)
    })
    .await;
    state.picker_open.store(false, Ordering::Release);
    result.map_err(|_| "The Save dialog could not complete. Try exporting again.".to_string())?
}

fn parse_external_url(value: &str) -> Result<Url, &'static str> {
    if value.len() > 8192 || value.chars().any(char::is_control) {
        return Err("This link is not a valid web address.");
    }
    let url = Url::parse(value).map_err(|_| "This link is not a valid web address.")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Only HTTP and HTTPS links can open in your browser.");
    }
    Ok(url)
}

#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let url = parse_external_url(&url).map_err(str::to_owned)?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|_| "Your default browser could not open this link.".into())
}

fn is_app_origin(url: &Url) -> bool {
    let production = url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && ((url.scheme() == "https" && url.host_str() == Some("tauri.localhost"))
            || (url.scheme() == "tauri" && url.host_str() == Some("localhost")));
    if production {
        return true;
    }
    cfg!(debug_assertions)
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
        && url.port() == Some(5182)
        && url.username().is_empty()
        && url.password().is_none()
}

fn is_app_navigation(url: &Url) -> bool {
    url.path() == "/desktop.html" && is_app_origin(url)
}

fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn main() {
    let state = DesktopState::default();
    let cwd = std::env::current_dir().unwrap_or_default();
    state
        .pending
        .lock()
        .expect("new file queue is available")
        .enqueue(resolve_launch_paths(std::env::args_os().skip(1), &cwd));

    tauri::Builder::default()
        .manage(state)
        // Register first: it forwards new launches before other plugins run.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths =
                resolve_launch_paths(args.into_iter().skip(1).map(Into::into), Path::new(&cwd));
            let state = app.state::<DesktopState>();
            let mut queue = state
                .pending
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            queue.enqueue(paths);
            drop(queue);
            // A lost early event is harmless: the reader always drains once after
            // registering its listener. Contents stay queued until that command.
            let _ = app.emit(FILES_PENDING_EVENT, ());
            focus_main(app);
        }))
        // The frontend's explicit open_external command owns link handling; do not
        // inject the opener plugin's broader mailto/tel/target=_blank interceptor.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            open_files,
            take_pending_files,
            open_external,
            save_export
        ])
        .setup(|app| {
            let config = app
                .config()
                .app
                .windows
                .first()
                .ok_or("missing main window configuration")?;
            WebviewWindowBuilder::from_config(app, config)?
                .on_navigation(is_app_navigation)
                .on_new_window(|_, _| NewWindowResponse::Deny)
                // Explicit exports use the async save_export command. Never open
                // modal UI from WebView2's synchronous download callback.
                .on_download(|_, _| false)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run MDviewer Desktop");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_links_cannot_launch_files_or_other_protocol_handlers() {
        for value in [
            "file:///C:/secret.md",
            "javascript:alert(1)",
            "data:text/html,hi",
            "cmd:calc",
            "mailto:a@example.com",
            "https://name:secret@example.com",
            "https://example.com/\nfoo",
        ] {
            assert!(
                parse_external_url(value).is_err(),
                "unexpected accepted scheme"
            );
        }
        assert_eq!(
            parse_external_url("https://example.com/a?q=1#two")
                .unwrap()
                .as_str(),
            "https://example.com/a?q=1#two"
        );
        assert!(parse_external_url("http://example.com").is_ok());
    }

    #[test]
    fn navigation_cannot_replace_the_app_with_an_external_or_lookalike_origin() {
        for value in [
            "https://example.com/desktop.html",
            "https://tauri.localhost.evil.example/desktop.html",
            "https://tauri.localhost:9000/desktop.html",
            "https://user@tauri.localhost/desktop.html",
            "file:///C:/desktop.html",
            "https://tauri.localhost/assets/app.js",
        ] {
            assert!(!is_app_navigation(&Url::parse(value).unwrap()));
        }
        assert!(is_app_navigation(
            &Url::parse("https://tauri.localhost/desktop.html#section").unwrap()
        ));
    }

    #[test]
    fn explicit_exports_replace_atomically_and_preserve_files_when_canceled_or_invalid() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("saved.md");
        std::fs::write(&destination, b"original").unwrap();
        assert!(
            persist_export(None, ExportKind::Markdown, b"new")
                .unwrap()
                .canceled
        );
        assert_eq!(std::fs::read(&destination).unwrap(), b"original");
        assert!(persist_export(Some(destination.clone()), ExportKind::Pdf, b"%PDF-1.7").is_err());
        assert_eq!(std::fs::read(&destination).unwrap(), b"original");
        assert!(
            !persist_export(
                Some(destination.clone()),
                ExportKind::Markdown,
                b"# replacement\n"
            )
            .unwrap()
            .canceled
        );
        assert_eq!(std::fs::read(&destination).unwrap(), b"# replacement\n");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
        let occupied = directory.path().join("occupied.md");
        std::fs::create_dir(&occupied).unwrap();
        std::fs::write(occupied.join("keep"), b"untouched").unwrap();
        assert!(persist_export(Some(occupied.clone()), ExportKind::Markdown, b"new").is_err());
        assert_eq!(std::fs::read(occupied.join("keep")).unwrap(), b"untouched");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 2);
    }
}
