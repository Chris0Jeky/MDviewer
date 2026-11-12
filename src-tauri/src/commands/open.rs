use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::file_policy::{read_batch, skipped_files_error, ReadBatch};
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
    fn follow(self, state: &DesktopState) -> Self {
        for doc in &self.documents {
            if let Some(token) = &doc.token {
                state.follow(token, std::path::Path::new(&doc.path));
            }
        }
        self
    }

    fn from_read_batch(batch: ReadBatch, registry: &mut Registry) -> Self {
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
                    let token = registry
                        .register(Binding {
                            path: doc.path,
                            identity: doc.identity,
                            digest: doc.digest,
                            len: doc.bytes,
                            encoding: doc.encoding,
                            eol: doc.eol,
                            generation: 0,
                        })
                        .ok();
                    OpenDocument {
                        name: doc.name,
                        text: doc.text,
                        bytes: doc.bytes,
                        token,
                        path,
                        dir,
                        encoding: doc.encoding.as_str(),
                        eol: doc.eol.as_str(),
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
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut picker = rfd::FileDialog::new()
            .set_title("Open Markdown")
            .add_filter("Markdown documents", &["md", "markdown"]);
        if let Some(window) = app.get_webview_window("main") {
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
        .follow(&state),
        None => OpenBatch {
            canceled: true,
            ..OpenBatch::default()
        },
    })
}

#[tauri::command]
pub(crate) async fn take_pending_files(
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
    .follow(&state))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_policy::MAX_BATCH_FILES;

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
