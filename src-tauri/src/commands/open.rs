use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::file_policy::{
    is_pdf_name, read_batch, skipped_files_error, ReadBatch, DATA_EXTENSIONS, MARKDOWN_EXTENSIONS,
    PDF_EXTENSIONS,
};
use crate::registry::{capture_revision, Binding, Registry, Token};
use crate::DesktopState;

// Paths returned here are display-only. Only OS arguments and native dialogs
// supply paths to the host; the webview cannot supply a filesystem path.
#[derive(Serialize)]
pub(crate) struct OpenDocument {
    name: String,
    text: String,
    bytes: u64,
    token: Option<Token>,
    path: String,
    dir: String,
    encoding: &'static str,
    eol: &'static str,
    /// `"pdf"` for a PDF: its token belongs to the PDF registry (commands/pdf.rs) and its bytes
    /// come from `read_pdf`; absent for text documents.
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<&'static str>,
}

#[derive(Serialize)]
pub(crate) struct OpenError {
    name: String,
    message: String,
}

#[derive(Default, Serialize)]
pub(crate) struct OpenBatch {
    documents: Vec<OpenDocument>,
    errors: Vec<OpenError>,
    canceled: bool,
}

impl OpenBatch {
    /// Start following every bound file in this batch.
    pub(crate) fn follow(self, state: &DesktopState) -> Self {
        for doc in self.documents.iter().filter(|doc| doc.kind.is_none()) {
            if let Some(token) = &doc.token {
                state.follow(token, std::path::Path::new(&doc.path));
            }
        }
        self
    }

    /// Record the opened files as recent in the library (paths and times only).
    pub(crate) fn remember(self, app: &AppHandle) -> Self {
        crate::commands::library::remember(
            app,
            self.documents
                .iter()
                .map(|doc| std::path::PathBuf::from(&doc.path)),
        );
        self
    }

    pub(crate) fn from_read_batch(batch: ReadBatch, registry: &mut Registry) -> Self {
        Self {
            documents: batch
                .documents
                .into_iter()
                .map(|doc| {
                    let path = doc.path.to_string_lossy().into_owned();
                    let dir = doc
                        .path
                        .parent()
                        .unwrap_or_else(|| std::path::Path::new(""))
                        .to_string_lossy()
                        .into_owned();
                    let pdf = is_pdf_name(&doc.name);
                    let binding = Binding {
                        path: doc.path,
                        identity: doc.identity,
                        digest: doc.digest,
                        len: doc.bytes,
                        encoding: doc.encoding,
                        eol: doc.eol,
                        generation: 0,
                    };
                    // A PDF's token lives in its own registry, so no text command
                    // (save, patch, reload) can ever resolve it.
                    let token = if pdf {
                        crate::commands::pdf::register(binding)
                    } else {
                        registry.register(binding).ok()
                    };
                    OpenDocument {
                        name: doc.name,
                        text: doc.text,
                        bytes: doc.bytes,
                        token,
                        path,
                        dir,
                        encoding: doc.encoding.as_str(),
                        eol: doc.eol.as_str(),
                        kind: pdf.then_some("pdf"),
                    }
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
pub(crate) async fn open_files(
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<OpenBatch, String> {
    if state
        .picker_open
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("A file picker is already open.".into());
    }
    let dialog_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let every: Vec<&str> = MARKDOWN_EXTENSIONS
            .iter()
            .chain(DATA_EXTENSIONS)
            .chain(PDF_EXTENSIONS)
            .copied()
            .collect();
        let mut picker = rfd::FileDialog::new()
            .set_title("Open")
            .add_filter("Markdown, PDF, data and text", &every)
            .add_filter("Markdown documents", MARKDOWN_EXTENSIONS)
            .add_filter("PDF documents", PDF_EXTENSIONS)
            .add_filter(
                "Data and text (JSON, YAML, TOML, CSV, text)",
                DATA_EXTENSIONS,
            );
        if let Some(window) = dialog_app.get_webview_window("main") {
            picker = picker.set_parent(&window);
        }
        picker
            .pick_files()
            .map(|selected| read_batch(selected, capture_revision))
    })
    .await;
    state.picker_open.store(false, Ordering::Release);
    let batch = result.map_err(|_| {
        "The file picker could not complete. Try opening the file again.".to_string()
    })?;
    Ok(match batch {
        Some(batch) => OpenBatch::from_read_batch(
            batch,
            &mut state
                .registry
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        )
        .follow(&state)
        .remember(&app),
        None => OpenBatch {
            canceled: true,
            ..OpenBatch::default()
        },
    })
}

#[tauri::command]
pub(crate) async fn take_pending_files(
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<OpenBatch, String> {
    let pending = {
        let mut queue = state
            .pending
            .lock()
            .map_err(|_| "The file-open queue is unavailable.".to_string())?;
        std::mem::take(&mut *queue)
    };
    let batch = tauri::async_runtime::spawn_blocking(move || {
        let mut batch = read_batch(pending.paths, capture_revision);
        if pending.skipped > 0 {
            batch.errors.push(skipped_files_error(pending.skipped));
        }
        batch
    })
    .await
    .map_err(|_| "The selected files could not be read. Try opening them again.".to_string())?;
    Ok(OpenBatch::from_read_batch(
        batch,
        &mut state
            .registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()),
    )
    .follow(&state)
    .remember(&app))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_policy::MAX_BATCH_FILES;

    #[test]
    fn a_pdf_gets_a_pdf_token_no_text_command_can_resolve_and_kind_pdf_on_the_wire() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("report.pdf");
        let bytes = b"%PDF-1.7
1 0 obj
<< >>
endobj
%%EOF
";
        std::fs::write(&path, bytes).unwrap();
        let mut registry = Registry::default();
        let batch = OpenBatch::from_read_batch(read_batch([path], capture_revision), &mut registry);
        assert!(batch.errors.is_empty());
        let doc = &batch.documents[0];
        assert_eq!(doc.kind, Some("pdf"));
        assert!(doc.text.is_empty());
        let token = doc.token.as_ref().unwrap();
        // Save, patch and reload look tokens up in this registry: a PDF token is never in it.
        assert!(registry.get(token).is_none());
        assert_eq!(registry.len(), 0);
        #[derive(serde::Deserialize)]
        struct Wire {
            kind: Option<String>,
            token: Option<String>,
        }
        let wire = tauri::ipc::IpcResponse::body(doc)
            .unwrap()
            .deserialize::<Wire>()
            .unwrap();
        assert_eq!(wire.kind.as_deref(), Some("pdf"));
        assert_eq!(
            crate::commands::pdf::read(&wire.token.unwrap()).unwrap(),
            bytes
        );
    }

    #[test]
    fn opened_documents_carry_display_metadata_and_matching_native_bindings() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("a.md");
        std::fs::write(&path, b"\xef\xbb\xbfhello\r\n").unwrap();
        let missing = directory.path().join("missing.md");
        let mut registry = Registry::default();
        let batch = OpenBatch::from_read_batch(
            read_batch([path.clone(), missing], capture_revision),
            &mut registry,
        );
        assert!(!batch.canceled);
        assert_eq!(batch.documents.len(), 1);
        let doc = &batch.documents[0];
        assert_eq!(doc.name, "a.md");
        assert_eq!(doc.text, "hello\r\n");
        assert_eq!(doc.bytes, 10);
        assert_eq!(doc.path, path.to_string_lossy());
        assert_eq!(doc.dir, directory.path().to_string_lossy());
        assert_eq!(doc.encoding, "utf-8-bom");
        assert_eq!(doc.eol, "crlf");
        // Exercise Tauri's actual JSON serialization, including the opaque token.
        let body = tauri::ipc::IpcResponse::body(doc).unwrap();
        let fields = body
            .clone()
            .deserialize::<std::collections::BTreeMap<String, serde::de::IgnoredAny>>()
            .unwrap();
        assert_eq!(
            fields.keys().map(String::as_str).collect::<Vec<_>>(),
            ["bytes", "dir", "encoding", "eol", "name", "path", "text", "token"]
        );
        #[derive(serde::Deserialize)]
        struct WireToken {
            token: Option<String>,
        }
        assert_eq!(
            body.deserialize::<WireToken>()
                .unwrap()
                .token
                .unwrap()
                .len(),
            32
        );
        let binding = registry.get(doc.token.as_ref().unwrap()).unwrap();
        assert_eq!(binding.path, path);
        assert_eq!(binding.len, doc.bytes);
        assert_eq!(binding.encoding.as_str(), doc.encoding);
        assert_eq!(binding.eol.as_str(), doc.eol);
        assert_eq!(binding.generation, 0);
        assert_eq!(batch.errors.len(), 1);
        assert_eq!(batch.errors[0].name, "missing.md");
        assert!(!batch.errors[0].message.contains(&doc.dir));
    }

    #[test]
    fn full_registry_keeps_opening_documents_unbound_without_evicting() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("a.md");
        std::fs::write(&path, b"hello").unwrap();
        let mut registry = Registry::default();
        let first = OpenBatch::from_read_batch(
            read_batch(vec![path.clone(); MAX_BATCH_FILES], capture_revision),
            &mut registry,
        );
        assert!(first.documents.iter().all(|doc| doc.token.is_some()));
        let overflow =
            OpenBatch::from_read_batch(read_batch([path], capture_revision), &mut registry);
        assert!(overflow.errors.is_empty());
        assert_eq!(overflow.documents.len(), 1);
        assert_eq!(overflow.documents[0].text, "hello");
        assert!(overflow.documents[0].token.is_none());
        let tauri::ipc::InvokeResponseBody::Json(wire) =
            tauri::ipc::IpcResponse::body(&overflow).unwrap()
        else {
            panic!("OpenBatch must serialize as JSON");
        };
        assert!(wire.contains("\"token\":null"));
        assert_eq!(registry.len(), MAX_BATCH_FILES);
        assert!(first
            .documents
            .iter()
            .all(|doc| registry.get(doc.token.as_ref().unwrap()).is_some()));
    }
}
