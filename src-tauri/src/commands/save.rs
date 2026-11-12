//! Owned Save / Save As (docs/design/FILE_LIFECYCLE.md). The webview supplies an
//! opaque token, the generation it last saw, and the text; never a path. Writes go
//! through `replace.rs`, which refuses rather than overwrite an outside change.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, State};

use crate::export_policy::{export_destination, export_name, ExportKind};
use crate::file_policy::{encode_markdown, EncodeError, Encoding, Eol, MAX_FILE_BYTES};
use crate::registry::{Binding, FileIdentity, Registry, Token};
use crate::replace::{self, ConflictKind, ReplaceError, ReplaceOutcome, Snapshot};
use crate::DesktopState;

/// The completion the frontend applies (FILE_LIFECYCLE "Captured revisions").
/// Failures carry a stable code and never a path or document content.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "outcome", rename_all = "kebab-case")]
pub(crate) enum SaveResult {
    Saved {
        token: Option<Token>,
        generation: u64,
        name: String,
        path: String,
        dir: String,
        encoding: &'static str,
        eol: &'static str,
    },
    Canceled,
    /// The file changed, moved, was replaced or is locked; nothing was written.
    Conflict {
        reason: &'static str,
    },
    /// The source mixed line endings; ask before normalising to LF.
    MixedLineEndings,
    Failed {
        code: &'static str,
    },
}

fn failed(code: &'static str) -> SaveResult {
    SaveResult::Failed { code }
}

fn conflict(kind: ConflictKind) -> SaveResult {
    SaveResult::Conflict {
        reason: match kind {
            ConflictKind::Changed => "changed",
            ConflictKind::Missing => "missing",
            ConflictKind::Replaced => "replaced",
            ConflictKind::Locked => "locked",
        },
    }
}

fn from_replace(error: ReplaceError) -> SaveResult {
    match error {
        ReplaceError::Conflict(kind) => conflict(kind),
        ReplaceError::Unsupported(_) => failed("unsupported"),
        ReplaceError::Io(..) => failed("write-failed"),
    }
}

fn encode(
    text: &str,
    encoding: Encoding,
    eol: Eol,
    accept_lf: bool,
) -> Result<Vec<u8>, SaveResult> {
    encode_markdown(text, encoding, eol, accept_lf).map_err(|error| match error {
        EncodeError::MixedLineEndings => SaveResult::MixedLineEndings,
        EncodeError::TooLarge => failed("too-large"),
    })
}

fn saved(token: Option<Token>, binding: &Binding) -> SaveResult {
    let path = &binding.path;
    SaveResult::Saved {
        token,
        generation: binding.generation,
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        dir: path
            .parent()
            .map(|dir| dir.to_string_lossy().into_owned())
            .unwrap_or_default(),
        encoding: binding.encoding.as_str(),
        eol: binding.eol.as_str(),
    }
}

fn snapshot_of(binding: &Binding) -> Option<Snapshot> {
    let FileIdentity {
        volume_serial,
        file_id,
    } = binding.identity?;
    Some(Snapshot {
        volume_serial,
        file_id,
        digest: binding.digest,
        len: binding.len,
    })
}

fn rebind(binding: &mut Binding, new: &Snapshot, eol: Eol) {
    binding.identity = Some(FileIdentity {
        volume_serial: new.volume_serial,
        file_id: new.file_id,
    });
    binding.digest = new.digest;
    binding.len = new.len;
    binding.eol = eol;
    binding.generation += 1;
}

/// Finish or roll back a save that a crash interrupted in this folder. Recovery
/// verifies every artifact before touching it and refuses on doubt; a refusal here
/// leaves those files alone and the new save proceeds under its own checks.
fn recover_interrupted(path: &Path) {
    if let Some(dir) = path.parent() {
        let _ = replace::recover_journal(dir);
    }
}

fn lock(registry: &Mutex<Registry>) -> std::sync::MutexGuard<'_, Registry> {
    registry
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Whether two absolute paths name the same location regardless of spelling:
/// a verbatim `\\?\` prefix, `/` versus `\`, `.` components and case. A path
/// with `..` is resolved lexically, as Win32 normalisation does.
fn same_location(a: &Path, b: &Path) -> bool {
    use std::path::{Component, Prefix};
    let parts = |path: &Path| -> Option<Vec<String>> {
        path.components()
            .filter(|part| !matches!(part, Component::CurDir))
            .map(|part| match part {
                Component::Prefix(prefix) => match prefix.kind() {
                    Prefix::VerbatimDisk(drive) | Prefix::Disk(drive) => {
                        Some(format!("{}:", (drive as char).to_ascii_lowercase()))
                    }
                    _ => Some(prefix.as_os_str().to_string_lossy().to_lowercase()),
                },
                Component::RootDir => Some(String::new()),
                // Resolve `..` lexically: a false "same" only fails closed into a conflict.
                Component::ParentDir => Some("..".into()),
                Component::CurDir => unreachable!("filtered above"),
                Component::Normal(name) => Some(name.to_string_lossy().to_lowercase()),
            })
            .collect()
    };
    let resolve = |parts: Vec<String>| {
        let mut out: Vec<String> = Vec::new();
        for part in parts {
            if part == ".." {
                // Never above the root (prefix and root stay).
                if out.len() > 2 {
                    out.pop();
                }
            } else {
                out.push(part);
            }
        }
        out
    };
    match (parts(a), parts(b)) {
        (Some(a), Some(b)) => resolve(a) == resolve(b),
        _ => false,
    }
}

/// Save to the bound file only if it is still the file and bytes this binding read.
pub(crate) fn save_bound(
    registry: &Mutex<Registry>,
    token: &Token,
    generation: u64,
    text: &str,
    accept_lf: bool,
) -> SaveResult {
    let (path, expected, encoding, eol) = {
        let registry = lock(registry);
        let Some(binding) = registry.get(token) else {
            return failed("revoked");
        };
        if binding.generation != generation {
            return failed("stale");
        }
        let Some(expected) = snapshot_of(binding) else {
            return failed("unsupported");
        };
        (
            binding.path.clone(),
            expected,
            binding.encoding,
            binding.eol,
        )
    };
    let bytes = match encode(text, encoding, eol, accept_lf) {
        Ok(bytes) => bytes,
        Err(result) => return result,
    };
    recover_interrupted(&path);
    // The registry lock is not held during I/O; the generation fences reentry.
    match replace::replace_if_unchanged(&path, &expected, &bytes) {
        Ok(ReplaceOutcome::Replaced(new)) => {
            let mut registry = lock(registry);
            let written_eol = if eol == Eol::Mixed { Eol::Lf } else { eol };
            match registry.get_mut(token) {
                Some(binding) if binding.generation == generation => {
                    rebind(binding, &new, written_eol);
                    saved(Some(token.clone()), binding)
                }
                // Released while writing: the bytes are on disk, the capability is gone.
                _ => failed("revoked-after-write"),
            }
        }
        Err(error) => from_replace(error),
    }
}

/// Write to a destination the user chose in the native dialog and bind it.
/// An existing destination is compared against what it held at selection (or,
/// if it is this document's own file, against what this document read).
pub(crate) fn save_to_path(
    registry: &Mutex<Registry>,
    previous: Option<&Token>,
    destination: &Path,
    text: &str,
    accept_lf: bool,
) -> SaveResult {
    if export_destination(destination, ExportKind::Markdown).is_err() {
        return failed("invalid-destination");
    }
    let own = previous.and_then(|token| {
        let registry = lock(registry);
        registry.get(token).map(|binding| {
            (
                snapshot_of(binding),
                binding.encoding,
                binding.eol,
                binding.path.clone(),
            )
        })
    });
    // A capability revoked while the picker was open never falls back to "no binding".
    if previous.is_some() && own.is_none() {
        return failed("revoked");
    }
    let (encoding, eol) = own
        .as_ref()
        .map_or((Encoding::Utf8, Eol::Lf), |own| (own.1, own.2));
    let bytes = match encode(text, encoding, eol, accept_lf) {
        Ok(bytes) => bytes,
        Err(result) => return result,
    };
    recover_interrupted(destination);
    // Choosing this document's own file by name gets exactly Save's check: what is
    // there now must still be what this document read, even if it was replaced or
    // deleted meanwhile. A picker confirmation never bypasses that.
    let same_name = |path: &Path| same_location(path, destination);
    if let Some((snapshot, _, _, path)) = own.as_ref().filter(|own| same_name(&own.3)) {
        let Some(snapshot) = snapshot else {
            return failed("unsupported");
        };
        if !path.exists() {
            return conflict(ConflictKind::Missing);
        }
        return finish_save_as(
            registry,
            previous,
            destination,
            encoding,
            eol,
            replace::replace_if_unchanged(destination, snapshot, &bytes),
        );
    }
    let outcome = match replace::snapshot_read(destination, MAX_FILE_BYTES) {
        Ok((current, _)) => {
            let same_file = own
                .as_ref()
                .and_then(|own| own.0.as_ref())
                .filter(|snapshot| {
                    snapshot.volume_serial == current.volume_serial
                        && snapshot.file_id == current.file_id
                });
            // A picker confirmation never bypasses this document's own conflict check.
            replace::replace_if_unchanged(destination, same_file.unwrap_or(&current), &bytes)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            replace::create_new(destination, &bytes)
        }
        Err(error) if error.kind() == std::io::ErrorKind::Unsupported => {
            return failed("unsupported")
        }
        Err(error) if error.kind() == std::io::ErrorKind::FileTooLarge => {
            return failed("too-large")
        }
        Err(_) => return conflict(ConflictKind::Locked),
    };
    finish_save_as(registry, previous, destination, encoding, eol, outcome)
}

fn finish_save_as(
    registry: &Mutex<Registry>,
    previous: Option<&Token>,
    destination: &Path,
    encoding: Encoding,
    eol: Eol,
    outcome: Result<ReplaceOutcome, ReplaceError>,
) -> SaveResult {
    let new = match outcome {
        Ok(ReplaceOutcome::Replaced(new)) => new,
        Err(error) => return from_replace(error),
    };
    let mut binding = Binding {
        path: destination.to_path_buf(),
        identity: None,
        digest: [0; 32],
        len: 0,
        encoding,
        eol,
        generation: 0,
    };
    rebind(
        &mut binding,
        &new,
        if eol == Eol::Mixed { Eol::Lf } else { eol },
    );
    binding.generation = 0;
    let mut registry = lock(registry);
    if let Some(token) = previous {
        registry.revoke(token);
    }
    // A full registry still reports the save; the document just stays unbound.
    let token = registry.register(binding.clone()).ok();
    saved(token, &binding)
}

struct Body<'a> {
    token: Option<Token>,
    generation: u64,
    name: String,
    accept_lf: bool,
    text: &'a str,
}

fn parse<'a>(request: &'a Request<'_>) -> Result<Body<'a>, String> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .filter(|value| value.len() <= 4096)
    };
    let token = match header("x-mdviewer-token") {
        Some(value) if !value.is_empty() => {
            Some(Token::parse(value).ok_or("The document capability is invalid.")?)
        }
        _ => None,
    };
    let generation = header("x-mdviewer-generation")
        .map(|value| {
            value
                .parse::<u64>()
                .map_err(|_| "The document revision is invalid.")
        })
        .transpose()?
        .unwrap_or(0);
    let name = header("x-mdviewer-filename")
        .map(|value| {
            percent_encoding::percent_decode_str(value)
                .decode_utf8_lossy()
                .into_owned()
        })
        .unwrap_or_default();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("The document must be sent as raw bytes.".into());
    };
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("This document exceeds the 25 MB limit.".into());
    }
    let text = std::str::from_utf8(bytes).map_err(|_| "The document is not valid UTF-8 text.")?;
    Ok(Body {
        token,
        generation,
        name,
        accept_lf: header("x-mdviewer-accept-lf") == Some("1"),
        text,
    })
}

/// One dialog or write transaction at a time; repeated commands get a busy result.
struct Busy<'a>(&'a std::sync::atomic::AtomicBool);
impl<'a> Busy<'a> {
    fn claim(flag: &'a std::sync::atomic::AtomicBool) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self(flag))
    }
}
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[tauri::command]
pub(crate) async fn save_document(
    state: State<'_, DesktopState>,
    request: Request<'_>,
) -> Result<SaveResult, String> {
    let body = parse(&request)?;
    let Some(token) = body.token else {
        return Ok(failed("revoked"));
    };
    let Some(_busy) = Busy::claim(&state.picker_open) else {
        return Ok(failed("busy"));
    };
    let text = body.text.to_owned();
    let (generation, accept_lf) = (body.generation, body.accept_lf);
    let registry = state.registry.clone();
    tauri::async_runtime::spawn_blocking(move || {
        save_bound(&registry, &token, generation, &text, accept_lf)
    })
    .await
    .map_err(|_| "The save could not complete. Your text is still open.".into())
}

#[tauri::command]
pub(crate) async fn save_document_as(
    app: AppHandle,
    state: State<'_, DesktopState>,
    request: Request<'_>,
) -> Result<SaveResult, String> {
    let body = parse(&request)?;
    // A token that no longer names a binding is refused before any dialog opens.
    if let Some(token) = &body.token {
        if lock(&state.registry).get(token).is_none() {
            return Ok(failed("revoked"));
        }
    }
    let Some(_busy) = Busy::claim(&state.picker_open) else {
        return Ok(failed("busy"));
    };
    let name = if export_name(&body.name) == Ok(ExportKind::Markdown) {
        body.name
    } else {
        "Untitled.md".into()
    };
    let (token, text, accept_lf) = (body.token, body.text.to_owned(), body.accept_lf);
    let dialog_app = app.clone();
    let chosen: Option<PathBuf> = tauri::async_runtime::spawn_blocking(move || {
        let mut picker = rfd::FileDialog::new()
            .set_title("Save Markdown")
            .set_file_name(&name)
            .add_filter("Markdown document", &["md", "markdown"]);
        if let Some(window) = dialog_app.get_webview_window("main") {
            picker = picker.set_parent(&window);
        }
        picker.save_file()
    })
    .await
    .map_err(|_| "The save dialog could not complete. Your text is still open.".to_string())?;
    let Some(destination) = chosen else {
        return Ok(SaveResult::Canceled);
    };
    let registry = state.registry.clone();
    let previous = token.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        save_to_path(&registry, token.as_ref(), &destination, &text, accept_lf)
    })
    .await
    .map_err(|_| "The save could not complete. Your text is still open.".to_string())?;
    if let SaveResult::Saved {
        token: new, path, ..
    } = &result
    {
        if let Some(previous) = &previous {
            state.unfollow(previous);
        }
        if let Some(new) = new {
            state.follow(new, Path::new(path));
        }
        crate::commands::library::remember(&app, [std::path::PathBuf::from(path)]);
    }
    Ok(result)
}

/// Release a closed document's capability. Unknown tokens are ignored.
#[tauri::command]
pub(crate) fn release_document(state: State<'_, DesktopState>, token: String) {
    if let Some(token) = Token::parse(&token) {
        lock(&state.registry).revoke(&token);
        state.unfollow(&token);
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use crate::file_policy::read_batch;
    use crate::registry::capture_revision;

    fn open(registry: &Mutex<Registry>, path: &Path) -> (Token, String) {
        let mut batch = read_batch([path.to_path_buf()], capture_revision);
        let doc = batch.documents.pop().expect("opened");
        let token = lock(registry)
            .register(Binding {
                path: doc.path,
                identity: doc.identity,
                digest: doc.digest,
                len: doc.bytes,
                encoding: doc.encoding,
                eol: doc.eol,
                generation: 0,
            })
            .unwrap();
        (token, doc.text)
    }

    fn generation(result: &SaveResult) -> u64 {
        match result {
            SaveResult::Saved { generation, .. } => *generation,
            other => panic!("expected a save, got {other:?}"),
        }
    }

    #[test]
    fn saves_in_place_byte_for_byte_and_fences_stale_and_revoked_completions() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.md");
        std::fs::write(&path, b"\xef\xbb\xbf# A\r\nline\r\n").unwrap();
        let registry = Mutex::new(Registry::default());
        let (token, text) = open(&registry, &path);
        assert_eq!(text, "# A\r\nline\r\n");
        // A textarea edit arrives as LF; the file keeps its BOM and CRLF.
        let first = save_bound(&registry, &token, 0, "# A\nline\nmore\n", false);
        assert_eq!(generation(&first), 1);
        assert_eq!(
            std::fs::read(&path).unwrap(),
            b"\xef\xbb\xbf# A\r\nline\r\nmore\r\n"
        );
        // A completion from before that save is stale and writes nothing.
        assert_eq!(
            save_bound(&registry, &token, 0, "old", false),
            failed("stale")
        );
        assert_eq!(
            generation(&save_bound(&registry, &token, 1, "# B\n", false)),
            2
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"\xef\xbb\xbf# B\r\n");
        lock(&registry).revoke(&token);
        assert_eq!(
            save_bound(&registry, &token, 2, "gone", false),
            failed("revoked")
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"\xef\xbb\xbf# B\r\n");
    }

    #[test]
    fn an_outside_change_or_a_second_binding_of_the_same_file_conflicts_without_writing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("same.md");
        std::fs::write(&path, b"one\n").unwrap();
        let registry = Mutex::new(Registry::default());
        let (first, _) = open(&registry, &path);
        let (second, _) = open(&registry, &path);
        assert_ne!(first, second);
        assert_eq!(
            generation(&save_bound(&registry, &first, 0, "two\n", false)),
            1
        );
        // The other open of the same file is now stale on disk (a save puts a new
        // file under the name): it must not overwrite.
        assert_eq!(
            save_bound(&registry, &second, 0, "three\n", false),
            SaveResult::Conflict { reason: "replaced" }
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"two\n");
        // An equal-length outside edit still conflicts.
        std::fs::write(&path, b"TWO\n").unwrap();
        assert_eq!(
            save_bound(&registry, &first, 1, "four\n", false),
            SaveResult::Conflict { reason: "changed" }
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"TWO\n");
        std::fs::remove_file(&path).unwrap();
        assert_eq!(
            save_bound(&registry, &first, 1, "five\n", false),
            SaveResult::Conflict { reason: "missing" }
        );
        assert!(!path.exists(), "a deleted file is never recreated by Save");
    }

    #[test]
    fn mixed_line_endings_ask_first_then_save_as_lf() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mixed.md");
        std::fs::write(&path, b"a\r\nb\n").unwrap();
        let registry = Mutex::new(Registry::default());
        let (token, _) = open(&registry, &path);
        assert_eq!(
            save_bound(&registry, &token, 0, "a\nb\nc\n", false),
            SaveResult::MixedLineEndings
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"a\r\nb\n");
        let saved = save_bound(&registry, &token, 0, "a\nb\nc\n", true);
        assert!(
            matches!(saved, SaveResult::Saved { eol: "lf", .. }),
            "{saved:?}"
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"a\nb\nc\n");
    }

    #[test]
    fn save_as_creates_without_clobbering_rebinds_and_checks_its_own_file() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("a.md");
        std::fs::write(&original, b"\xff\xfea\x00\r\x00\n\x00").unwrap(); // UTF-16LE "a\r\n"
        let registry = Mutex::new(Registry::default());
        let (token, _) = open(&registry, &original);
        let copy = dir.path().join("b.md");
        let result = save_to_path(&registry, Some(&token), &copy, "a\nz\n", false);
        let SaveResult::Saved {
            token: Some(new),
            name,
            encoding,
            eol,
            generation,
            ..
        } = result
        else {
            panic!("expected a save, got {result:?}");
        };
        assert_eq!(
            (name.as_str(), encoding, eol, generation),
            ("b.md", "utf-16le", "crlf", 0)
        );
        assert_eq!(
            std::fs::read(&copy).unwrap(),
            b"\xff\xfea\x00\r\x00\n\x00z\x00\r\x00\n\x00"
        );
        assert_eq!(
            std::fs::read(&original).unwrap(),
            b"\xff\xfea\x00\r\x00\n\x00"
        );
        // The old capability is released; the new one saves the new file.
        assert_eq!(
            save_bound(&registry, &token, 0, "x", false),
            failed("revoked")
        );
        assert_eq!(
            generation_of(&save_bound(&registry, &new, 0, "b\n", false)),
            1
        );
        // Save As onto its own file after an outside change is a conflict, not an overwrite.
        std::fs::write(&copy, b"outside").unwrap();
        assert_eq!(
            save_to_path(&registry, Some(&new), &copy, "mine\n", false),
            SaveResult::Conflict { reason: "changed" }
        );
        assert_eq!(std::fs::read(&copy).unwrap(), b"outside");
        // An unrelated existing file the user confirmed in the picker is replaced.
        let other = dir.path().join("other.md");
        std::fs::write(&other, b"old").unwrap();
        assert!(matches!(
            save_to_path(&registry, None, &other, "new\n", false),
            SaveResult::Saved {
                encoding: "utf-8",
                eol: "lf",
                ..
            }
        ));
        assert_eq!(std::fs::read(&other).unwrap(), b"new\n");
        assert_eq!(
            save_to_path(&registry, None, &dir.path().join("x.txt"), "t", false),
            failed("invalid-destination")
        );
    }

    #[test]
    fn locations_compare_by_component_not_spelling() {
        let same = |a: &str, b: &str| same_location(Path::new(a), Path::new(b));
        assert!(same(r"C:\Notes\a.md", r"c:\notes\A.MD"));
        assert!(same(r"\\?\C:\Notes\a.md", r"C:\Notes\a.md"));
        assert!(same(r"C:/Notes/a.md", r"C:\Notes\a.md"));
        assert!(same(r"C:\Notes\.\a.md", r"C:\Notes\a.md"));
        assert!(same(r"C:\Notes\x\..\a.md", r"C:\Notes\a.md"));
        assert!(!same(r"C:\Notes\a.md", r"D:\Notes\a.md"));
        assert!(!same(r"C:\Notes\a.md", r"C:\Notes\b.md"));
    }

    #[test]
    fn save_as_onto_its_own_replaced_or_deleted_file_is_a_conflict_not_an_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Notes.md");
        std::fs::write(
            &path, b"mine
",
        )
        .unwrap();
        let registry = Mutex::new(Registry::default());
        let (token, _) = open(&registry, &path);
        // Another program replaces the file (new identity, new bytes).
        let swap = dir.path().join("swap.tmp");
        std::fs::write(
            &swap, b"theirs
",
        )
        .unwrap();
        std::fs::remove_file(&path).unwrap();
        std::fs::rename(&swap, &path).unwrap();
        // The user picks the same file (any case) in Save As and confirms overwrite.
        let picked = dir.path().join("notes.md");
        assert!(matches!(
            save_to_path(
                &registry,
                Some(&token),
                &picked,
                "edited
",
                false
            ),
            SaveResult::Conflict { .. }
        ));
        assert_eq!(
            std::fs::read(&path).unwrap(),
            b"theirs
"
        );
        std::fs::remove_file(&path).unwrap();
        assert_eq!(
            save_to_path(
                &registry,
                Some(&token),
                &picked,
                "edited
",
                false
            ),
            SaveResult::Conflict { reason: "missing" }
        );
        assert!(
            !path.exists(),
            "Save As never recreates its own deleted file"
        );
        // The binding is still live for a different destination.
        assert!(matches!(
            save_to_path(
                &registry,
                Some(&token),
                &dir.path().join("copy.md"),
                "edited
",
                false
            ),
            SaveResult::Saved { .. }
        ));
    }

    fn generation_of(result: &SaveResult) -> u64 {
        generation(result)
    }

    #[test]
    fn results_serialize_as_tagged_outcomes_without_paths_in_failures() {
        use std::collections::BTreeMap;
        let body = |result: SaveResult| {
            tauri::ipc::IpcResponse::body(result)
                .unwrap()
                .deserialize::<BTreeMap<String, String>>()
                .unwrap()
        };
        let map = |pairs: &[(&str, &str)]| {
            pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect::<BTreeMap<_, _>>()
        };
        assert_eq!(body(SaveResult::Canceled), map(&[("outcome", "canceled")]));
        assert_eq!(
            body(failed("busy")),
            map(&[("outcome", "failed"), ("code", "busy")])
        );
        assert_eq!(
            body(SaveResult::Conflict { reason: "locked" }),
            map(&[("outcome", "conflict"), ("reason", "locked")])
        );
        assert_eq!(
            body(SaveResult::MixedLineEndings),
            map(&[("outcome", "mixed-line-endings")])
        );
    }
}
