use std::io::Write;
use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, State};

use crate::export_policy::{export_data, export_destination, export_name, export_size, ExportKind};
use crate::file_policy::{DATA_EXTENSIONS, MARKDOWN_EXTENSIONS};
use crate::DesktopState;

#[derive(Debug, Serialize)]
pub(crate) struct SaveExportResult {
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
pub(crate) async fn save_export(
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
            ExportKind::Markdown => picker.add_filter("Markdown document", MARKDOWN_EXTENSIONS),
            ExportKind::Data => picker.add_filter("Data or text document", DATA_EXTENSIONS),
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

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn a_data_copy_keeps_its_data_extension() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("copy.json");
        assert!(
            !persist_export(
                Some(destination.clone()),
                ExportKind::Data,
                b"{\"k\": 1}
"
            )
            .unwrap()
            .canceled
        );
        assert_eq!(
            std::fs::read(&destination).unwrap(),
            b"{\"k\": 1}
"
        );
        assert!(persist_export(
            Some(directory.path().join("copy.md")),
            ExportKind::Data,
            b"{}"
        )
        .is_err());
        assert!(!directory.path().join("copy.md").exists());
    }
}
