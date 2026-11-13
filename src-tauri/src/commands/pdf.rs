//! PDF bytes for the PDF workbench (docs/design/PDF_WORKBENCH.md, P1b). PDFs are opened through
//! the ordinary open paths (picker, launch, Library) under `file_policy`; their capability tokens
//! live in this module's own registry, apart from text documents, so save, patch and reload can
//! never resolve a PDF token. The webview never sends a path.

use std::sync::{LazyLock, Mutex, MutexGuard};

use tauri::ipc::Response;

use crate::file_policy::{read_markdown, MAX_PDF_BYTES};
use crate::registry::{capture_revision, Binding, Registry, Token};

// ponytail: one process-wide registry; the app has one window. Move into DesktopState if a
// second window ever opens documents.
static PDFS: LazyLock<Mutex<Registry>> = LazyLock::new(|| Mutex::new(Registry::default()));

fn pdfs() -> MutexGuard<'static, Registry> {
    PDFS.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn register(binding: Binding) -> Option<Token> {
    pdfs().register(binding).ok()
}

/// The bytes of an opened PDF, re-read through the open policy. Refused with `changed` when the
/// file on disk is no longer the one that was opened (digest compare), and `revoked` for an
/// unknown or released token.
pub(crate) fn read(token: &str) -> Result<Vec<u8>, &'static str> {
    let token = Token::parse(token).ok_or("revoked")?;
    let (path, digest) = pdfs()
        .get(&token)
        .map(|binding| (binding.path.clone(), binding.digest))
        .ok_or("revoked")?;
    let document = read_markdown(&path, MAX_PDF_BYTES, capture_revision).map_err(|_| "unreadable")?;
    if document.digest != digest {
        return Err("changed");
    }
    document.pdf.ok_or("unreadable")
}

#[tauri::command]
pub(crate) async fn read_pdf(token: String) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || read(&token))
        .await
        .map_err(|_| "unreadable".to_string())?
        .map(Response::new)
        .map_err(str::to_owned)
}

#[tauri::command]
pub(crate) fn release_pdf(token: String) {
    if let Some(token) = Token::parse(&token) {
        pdfs().revoke(&token);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_policy::{read_batch, MAX_FILE_BYTES};

    struct Dir(std::path::PathBuf);
    impl Dir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("mdv-pdf-{}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    const PDF: &[u8] = b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n";

    fn text(token: &Token) -> String {
        serde_json::to_value(token).unwrap().as_str().unwrap().to_owned()
    }

    fn binding(document: &crate::file_policy::Document) -> Binding {
        Binding {
            path: document.path.clone(),
            identity: document.identity,
            digest: document.digest,
            len: document.bytes,
            encoding: document.encoding,
            eol: document.eol,
            generation: 0,
        }
    }

    #[test]
    fn a_pdf_opens_as_bytes_outside_the_text_budget_and_reads_back_until_it_changes() {
        let dir = Dir::new();
        let path = dir.0.join("Report.PDF");
        std::fs::write(&path, PDF).unwrap();
        let batch = read_batch([path.clone()], capture_revision);
        assert!(batch.errors.is_empty(), "{:?}", batch.errors);
        let document = &batch.documents[0];
        assert!(document.text.is_empty());
        assert!(document.pdf.is_none(), "read_batch drops the bytes; read_pdf re-reads them");
        let token = register(binding(document)).unwrap();
        assert_eq!(read(&text(&token)).unwrap(), PDF);

        std::fs::write(&path, b"%PDF-1.7\nchanged\n").unwrap();
        assert_eq!(read(&text(&token)), Err("changed"));
        release_pdf(text(&token));
        assert_eq!(read(&text(&token)), Err("revoked"));
        assert_eq!(read("not-a-token"), Err("revoked"));
    }

    #[test]
    fn a_file_named_pdf_without_the_signature_is_refused() {
        let dir = Dir::new();
        let path = dir.0.join("fake.pdf");
        std::fs::write(&path, b"# not a pdf").unwrap();
        let batch = read_batch([path], capture_revision);
        assert_eq!(batch.documents.len(), 0);
        assert_eq!(batch.errors[0].message, "This file is not a PDF.");
    }

    #[test]
    fn a_pdf_is_admitted_beside_text_without_spending_the_text_limit() {
        let dir = Dir::new();
        let pdf = dir.0.join("big.pdf");
        let mut bytes = PDF.to_vec();
        bytes.resize(MAX_FILE_BYTES as usize + 1, b' ');
        std::fs::write(&pdf, &bytes).unwrap();
        let note = dir.0.join("note.md");
        std::fs::write(&note, "# Note").unwrap();
        let batch = read_batch([pdf, note], capture_revision);
        assert!(batch.errors.is_empty(), "{:?}", batch.errors);
        assert_eq!(batch.documents.len(), 2);
        assert_eq!(batch.documents[0].bytes, MAX_FILE_BYTES + 1);
        assert_eq!(batch.documents[1].text, "# Note");
    }
}
