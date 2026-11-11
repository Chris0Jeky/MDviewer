//! Actionable Markdown write-back (A2): apply line patches to a bound file as one
//! conflict-checked change. The webview sends the document token and the patches,
//! never a path. Only the placed lines' content bytes change (`linepatch.rs`).

use serde::Serialize;
use tauri::State;

use crate::file_policy::{Eol, MAX_FILE_BYTES};
use crate::linepatch::{self, Patch, PatchError};
use crate::registry::{FileIdentity, Token};
use crate::replace::{self, ReplaceError, ReplaceOutcome, Snapshot};
use crate::DesktopState;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "outcome", rename_all = "kebab-case")]
pub(crate) enum PatchResult {
    /// Written. `text` is the file's new full text; `generation` the binding's.
    Saved {
        generation: u64,
        text: String,
    },
    /// Patch `index` could not be placed on the current file; nothing was written.
    /// `text` is the current file text so the parser can re-derive the patch.
    Unplaced {
        index: usize,
        text: String,
    },
    Failed {
        code: &'static str,
    },
}

fn failed(code: &'static str) -> PatchResult {
    PatchResult::Failed { code }
}

/// Read, place and commit; on a conflict (the file changed between our read and
/// the commit) re-read and place once more. Pure of Tauri for tests.
pub(crate) fn patch_file(
    path: &std::path::Path,
    patches: &[Patch],
) -> Result<(Snapshot, String), PatchResult> {
    for attempt in 0..2 {
        let (snapshot, raw) =
            replace::snapshot_read(path, MAX_FILE_BYTES).map_err(|error| match error.kind() {
                std::io::ErrorKind::NotFound => failed("missing"),
                std::io::ErrorKind::Unsupported => failed("unsupported"),
                std::io::ErrorKind::FileTooLarge => failed("too-large"),
                _ => failed("unreadable"),
            })?;
        let (bytes, text) = match linepatch::apply(&raw, patches) {
            Ok(applied) => applied,
            Err(PatchError::Unplaced(index)) => {
                let text = linepatch::text_of(&raw).unwrap_or_default();
                return Err(PatchResult::Unplaced { index, text });
            }
            Err(PatchError::Invalid(_)) => return Err(failed("invalid")),
            Err(PatchError::Encoding) => return Err(failed("encoding")),
        };
        if bytes.len() as u64 > MAX_FILE_BYTES {
            return Err(failed("too-large"));
        }
        match replace::replace_if_unchanged(path, &snapshot, &bytes) {
            Ok(ReplaceOutcome::Replaced(new)) => return Ok((new, text)),
            Err(ReplaceError::Conflict(_)) if attempt == 0 => continue,
            Err(ReplaceError::Conflict(_)) => return Err(failed("conflict")),
            Err(ReplaceError::Unsupported(_)) => return Err(failed("unsupported")),
            Err(ReplaceError::Io(..)) => return Err(failed("write-failed")),
        }
    }
    Err(failed("conflict"))
}

#[tauri::command]
pub(crate) async fn patch_document(
    state: State<'_, DesktopState>,
    token: String,
    patches: Vec<Patch>,
) -> Result<PatchResult, String> {
    let Some(token) = Token::parse(&token) else {
        return Ok(failed("revoked"));
    };
    let lock = || {
        state
            .registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    };
    let Some(path) = lock().get(&token).map(|binding| binding.path.clone()) else {
        return Ok(failed("revoked"));
    };
    let result = tauri::async_runtime::spawn_blocking(move || patch_file(&path, &patches))
        .await
        .map_err(|_| "The change could not be saved.".to_string())?;
    let (new, text) = match result {
        Ok(done) => done,
        Err(outcome) => return Ok(outcome),
    };
    // Move the binding to the bytes we wrote: the watcher then sees no outside
    // change, and a later Save compares against this version.
    let mut registry = lock();
    let Some(binding) = registry.get_mut(&token) else {
        return Ok(failed("revoked-after-write"));
    };
    binding.identity = Some(FileIdentity {
        volume_serial: new.volume_serial,
        file_id: new.file_id,
    });
    binding.digest = new.digest;
    binding.len = new.len;
    binding.eol = Eol::detect(&text);
    binding.generation += 1;
    Ok(PatchResult::Saved {
        generation: binding.generation,
        text,
    })
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::process::Command;

    fn p(line: usize, id: Option<&str>, expect: &str, replace: &str) -> Patch {
        Patch {
            line,
            id: id.map(str::to_owned),
            expect: expect.into(),
            replace: replace.into(),
        }
    }

    #[test]
    fn writes_byte_exact_through_the_conflict_safe_replace() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("desk.md");
        std::fs::write(
            &path,
            b"\xef\xbb\xbf# Desk\r\n- [ ] run 01 <!-- id: r1 -->\n",
        )
        .unwrap();
        let checked = "- [x] run 01 <!-- id: r1 -->";
        let (_, text) = patch_file(
            &path,
            &[p(1, Some("r1"), "- [ ] run 01 <!-- id: r1 -->", checked)],
        )
        .unwrap();
        assert_eq!(
            std::fs::read(&path).unwrap(),
            b"\xef\xbb\xbf# Desk\r\n- [x] run 01 <!-- id: r1 -->\n"
        );
        assert_eq!(text, "# Desk\r\n- [x] run 01 <!-- id: r1 -->\n");
    }

    #[test]
    fn places_after_a_second_process_rewrote_the_file_and_refuses_when_it_cannot() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("card.md");
        std::fs::write(&path, b"- [ ] a <!-- id: a -->\n").unwrap();
        // Another process (a run-card generator) inserts lines above the control.
        let script = format!(
            "[IO.File]::WriteAllBytes('{}', [Text.Encoding]::UTF8.GetBytes(\"## Run 02{}notes{}- [ ] a <!-- id: a -->{}\"))",
            path.display(),
            "$([char]13)$([char]10)",
            "$([char]13)$([char]10)",
            "$([char]10)"
        );
        let status = Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", &script])
            .status()
            .unwrap();
        assert!(status.success());
        let control = p(
            0,
            Some("a"),
            "- [ ] a <!-- id: a -->",
            "- [x] a <!-- id: a -->",
        );
        patch_file(&path, std::slice::from_ref(&control)).unwrap();
        assert_eq!(
            std::fs::read(&path).unwrap(),
            b"## Run 02\r\nnotes\r\n- [x] a <!-- id: a -->\n"
        );
        // The control itself changed: nothing is written, the current text comes back.
        std::fs::write(&path, b"- [ ] a renamed <!-- id: a -->\n").unwrap();
        assert_eq!(
            patch_file(&path, &[control]).unwrap_err(),
            PatchResult::Unplaced {
                index: 0,
                text: "- [ ] a renamed <!-- id: a -->\n".into()
            }
        );
        assert_eq!(
            std::fs::read(&path).unwrap(),
            b"- [ ] a renamed <!-- id: a -->\n"
        );
    }

    #[test]
    fn a_choice_group_is_all_or_nothing_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pick.md");
        let raw = b"(x) one <!-- id: o -->\n( ) two <!-- id: t -->\n";
        std::fs::write(&path, raw).unwrap();
        let bad = [
            p(
                0,
                Some("o"),
                "(x) one <!-- id: o -->",
                "( ) one <!-- id: o -->",
            ),
            p(
                1,
                Some("t"),
                "( ) TWO <!-- id: t -->",
                "(x) TWO <!-- id: t -->",
            ),
        ];
        assert!(matches!(
            patch_file(&path, &bad),
            Err(PatchResult::Unplaced { index: 1, .. })
        ));
        assert_eq!(
            std::fs::read(&path).unwrap(),
            raw,
            "the first patch was not written alone"
        );
        assert_eq!(
            patch_file(&dir.path().join("none.md"), &bad).unwrap_err(),
            failed("missing")
        );
    }
}
