//! Live reload (companion push S1c). The watcher tells the webview only which
//! tokens changed; the webview then asks here what happened to each file.

use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

use crate::file_policy::{read_markdown, MAX_FILE_BYTES};
use crate::registry::{capture_revision, Registry, Token};
use crate::DesktopState;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "outcome", rename_all = "kebab-case")]
pub(crate) enum ReadResult {
    /// The bytes are the ones this binding last read or saved (e.g. our own save).
    Unchanged,
    /// Different bytes are on disk. `text` is present only when adopted.
    Changed {
        text: Option<String>,
        generation: u64,
        encoding: &'static str,
        eol: &'static str,
    },
    /// The file was moved or deleted. The open text is untouched.
    Missing,
    Failed {
        code: &'static str,
    },
}

fn lock(registry: &Mutex<Registry>) -> std::sync::MutexGuard<'_, Registry> {
    registry
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Re-read the bound file. With `adopt`, the binding moves to the new bytes, so a
/// later Save compares against them; without it, the binding keeps the old read
/// and a Save of the open text still conflicts (nothing is overwritten silently).
pub(crate) fn reread(registry: &Mutex<Registry>, token: &Token, adopt: bool) -> ReadResult {
    let Some((path, digest)) = lock(registry)
        .get(token)
        .map(|binding| (binding.path.clone(), binding.digest))
    else {
        return ReadResult::Failed { code: "revoked" };
    };
    if !path.exists() {
        return ReadResult::Missing;
    }
    let doc = match read_markdown(&path, MAX_FILE_BYTES, capture_revision) {
        Ok(doc) => doc,
        Err(_) if !path.exists() => return ReadResult::Missing,
        Err(_) => return ReadResult::Failed { code: "unreadable" },
    };
    let mut registry = lock(registry);
    let Some(binding) = registry.get_mut(token) else {
        return ReadResult::Failed { code: "revoked" };
    };
    if doc.digest == digest {
        // Same bytes (our own save echoing, or a rewrite with identical content):
        // follow a new identity silently so the next Save does not see "replaced".
        binding.identity = doc.identity;
        return ReadResult::Unchanged;
    }
    if !adopt {
        return ReadResult::Changed {
            text: None,
            generation: binding.generation,
            encoding: binding.encoding.as_str(),
            eol: binding.eol.as_str(),
        };
    }
    binding.identity = doc.identity;
    binding.digest = doc.digest;
    binding.len = doc.bytes;
    binding.encoding = doc.encoding;
    binding.eol = doc.eol;
    binding.generation += 1;
    ReadResult::Changed {
        text: Some(doc.text),
        generation: binding.generation,
        encoding: binding.encoding.as_str(),
        eol: binding.eol.as_str(),
    }
}

#[tauri::command]
pub(crate) async fn read_document(
    state: State<'_, DesktopState>,
    token: String,
    adopt: bool,
) -> Result<ReadResult, String> {
    let Some(token) = Token::parse(&token) else {
        return Ok(ReadResult::Failed { code: "revoked" });
    };
    let registry = state.registry.clone();
    tauri::async_runtime::spawn_blocking(move || reread(&registry, &token, adopt))
        .await
        .map_err(|_| "The file could not be read again.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::save::save_bound;
    use crate::file_policy::read_batch;
    use crate::registry::Binding;

    fn open(registry: &Mutex<Registry>, path: &std::path::Path) -> Token {
        let doc = read_batch([path.to_path_buf()], capture_revision)
            .documents
            .pop()
            .unwrap();
        lock(registry)
            .register(Binding {
                path: doc.path,
                identity: doc.identity,
                digest: doc.digest,
                len: doc.bytes,
                encoding: doc.encoding,
                eol: doc.eol,
                generation: 0,
            })
            .unwrap()
    }

    #[test]
    fn our_own_save_is_not_an_outside_change_and_outside_edits_are_adopted_only_on_request() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("live.md");
        std::fs::write(&path, b"one\r\n").unwrap();
        let registry = Mutex::new(Registry::default());
        let token = open(&registry, &path);
        assert_eq!(reread(&registry, &token, true), ReadResult::Unchanged);
        #[cfg(windows)]
        {
            assert!(matches!(
                save_bound(&registry, &token, 0, "two\n", false),
                crate::commands::save::SaveResult::Saved { .. }
            ));
            assert_eq!(
                reread(&registry, &token, false),
                ReadResult::Unchanged,
                "no echo"
            );
        }
        let generation = lock(&registry).get(&token).unwrap().generation;
        std::fs::write(&path, b"outside\n").unwrap();
        // Dirty document: report the change, keep the old read so Save conflicts.
        assert!(matches!(
            reread(&registry, &token, false),
            ReadResult::Changed { text: None, .. }
        ));
        assert_eq!(lock(&registry).get(&token).unwrap().generation, generation);
        // Clean document (or Reload): adopt the new bytes.
        assert_eq!(
            reread(&registry, &token, true),
            ReadResult::Changed {
                text: Some("outside\n".into()),
                generation: generation + 1,
                encoding: "utf-8",
                eol: "lf"
            }
        );
        assert_eq!(reread(&registry, &token, true), ReadResult::Unchanged);
        std::fs::remove_file(&path).unwrap();
        assert_eq!(reread(&registry, &token, true), ReadResult::Missing);
        lock(&registry).revoke(&token);
        assert_eq!(
            reread(&registry, &token, true),
            ReadResult::Failed { code: "revoked" }
        );
    }
}
