//! Relative references from an open document (companion push S6): links to other
//! Markdown files, Claude-style `@path` imports and local images. Every reference
//! is resolved against the folder of the document's own binding and then passes
//! the same local-file policy as an open. The webview supplies only the document's
//! token and the reference text as written in the document.

use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use crate::file_policy::{is_local_file_path, MARKDOWN_EXTENSIONS};

pub const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

/// Resolve a reference written in a document at `document` to a local path.
/// Accepts relative paths (with `/` or `\`), percent-encoding, a leading `@`
/// (imports) and `./`/`../` segments; drops `#fragment` and `?query`. Refuses
/// URLs, absolute, rooted, drive-relative and UNC forms, and anything whose
/// result is not an ordinary local path.
pub fn resolve(document: &Path, reference: &str) -> Option<PathBuf> {
    let reference = reference.trim();
    let reference = reference.strip_prefix('@').unwrap_or(reference);
    let reference = reference.split(['#', '?']).next().unwrap_or("");
    if reference.is_empty() || reference.contains(':') || reference.starts_with(['/', '\\']) {
        return None;
    }
    let decoded = percent_encoding::percent_decode_str(reference)
        .decode_utf8()
        .ok()?
        .replace('/', "\\");
    if decoded.contains(':') || decoded.starts_with('\\') || decoded.chars().any(char::is_control) {
        return None;
    }
    let mut resolved = document.parent()?.to_path_buf();
    for part in Path::new(&decoded).components() {
        match part {
            Component::Normal(name) => resolved.push(name),
            Component::CurDir => {}
            Component::ParentDir => {
                // Never climb above the drive root.
                if !resolved.pop() || resolved.parent().is_none() {
                    return None;
                }
            }
            Component::Prefix(_) | Component::RootDir => return None,
        }
    }
    is_local_file_path(&resolved).then_some(resolved)
}

/// True when no path component of `target` that the user's own open did not already
/// traverse is a symlink or junction. A link planted in a folder (a cloned repository)
/// could point at a network share (`\\server\share`), and opening through it would start an SMB
/// connection, leaking credentials, before any file check runs. Components shared
/// with the document's own folder were traversed by the user's open and stay allowed;
/// OneDrive placeholders are not name surrogates and stay allowed.
/// ponytail: check-then-open, so a local writer could swap a component in between;
/// open by handle with FILE_FLAG_OPEN_REPARSE_POINT per component if that matters.
pub fn without_new_links(document: &Path, target: &Path) -> bool {
    let trusted = document.parent().unwrap_or(document);
    let mut prefix = PathBuf::new();
    for part in target.components() {
        prefix.push(part);
        if trusted.starts_with(&prefix) {
            continue;
        }
        match std::fs::symlink_metadata(&prefix) {
            // std reports junctions and symlinks (name-surrogate reparse points) here.
            Ok(meta) if meta.file_type().is_symlink() => return false,
            Ok(_) => {}
            // Nothing deeper exists, so the open fails locally without following anything.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return true,
            Err(_) => return false,
        }
    }
    true
}

/// Add `.md` to an extensionless wiki-style name (`[[name]]` → `name.md`).
pub fn with_markdown_extension(path: PathBuf) -> PathBuf {
    if path.extension().is_none() {
        path.with_extension("md")
    } else {
        path
    }
}

/// A link from a document may open another Markdown document, never a data or text file:
/// those open only through the user's own choice (dialog, launch, Library), because a link
/// opens and binds its target writable with no dialog (docs/design/READABLE_DATA.md).
pub fn is_markdown_target(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            MARKDOWN_EXTENSIONS
                .iter()
                .any(|md| ext.eq_ignore_ascii_case(md))
        })
}

pub fn image_type(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        // Shown through <img> from a blob URL: SVG scripts and external loads never run.
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

/// Read a local image for the reader: an allowed type, a regular file, at most 20 MB.
pub fn read_image(path: &Path) -> Result<(Vec<u8>, &'static str), &'static str> {
    let kind = image_type(path).ok_or("unsupported-type")?;
    let file = File::open(path).map_err(|_| "unreadable")?;
    let metadata = file.metadata().map_err(|_| "unreadable")?;
    if !metadata.is_file() {
        return Err("unreadable");
    }
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err("too-large");
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "unreadable")?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("too-large");
    }
    Ok((bytes, kind))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn refuses_a_junction_below_the_documents_folder() {
        let dir = tempfile::tempdir().unwrap();
        let docs = dir.path().join("docs");
        let elsewhere = dir.path().join("elsewhere");
        std::fs::create_dir_all(&docs).unwrap();
        std::fs::create_dir_all(&elsewhere).unwrap();
        std::fs::write(elsewhere.join("a.png"), b"x").unwrap();
        std::fs::create_dir_all(docs.join("img")).unwrap();
        std::fs::write(docs.join("img").join("a.png"), b"x").unwrap();
        let document = docs.join("guide.md");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(docs.join("link"))
            .arg(&elsewhere)
            .output()
            .unwrap();
        assert!(status.status.success());
        assert!(without_new_links(
            &document,
            &docs.join("img").join("a.png")
        ));
        assert!(without_new_links(
            &document,
            &docs.join("missing").join("a.png")
        ));
        assert!(!without_new_links(
            &document,
            &docs.join("link").join("a.png")
        ));
        // `../` climbs stay allowed when the climbed-to folders are plain.
        assert!(without_new_links(&document, &elsewhere.join("a.png")));
    }

    fn doc() -> PathBuf {
        PathBuf::from(r"C:\work\repo\docs\guide.md")
    }

    #[test]
    fn resolves_relative_references_against_the_documents_folder() {
        let cases = [
            ("other.md", r"C:\work\repo\docs\other.md"),
            ("./other.md#section", r"C:\work\repo\docs\other.md"),
            ("../README.md", r"C:\work\repo\README.md"),
            (
                "sub/deep%20note.md?x=1",
                r"C:\work\repo\docs\sub\deep note.md",
            ),
            ("@../CLAUDE.md", r"C:\work\repo\CLAUDE.md"),
            (r"img\diagram.png", r"C:\work\repo\docs\img\diagram.png"),
        ];
        for (reference, expected) in cases {
            assert_eq!(
                resolve(&doc(), reference),
                Some(PathBuf::from(expected)),
                "{reference}"
            );
        }
    }

    #[test]
    fn refuses_urls_absolute_paths_and_escapes() {
        for reference in [
            "https://example.com/a.md",
            "file:///C:/secret.md",
            "C:/Windows/win.ini",
            r"C:\secret.md",
            "/etc/passwd",
            r"\\server\share\a.md",
            "//server/share/a.md",
            "%5C%5Cserver%5Cshare%5Ca.md",
            "C%3A%5Csecret.md",
            "../../../../../../../../x.md",
            "",
            "#only-a-fragment",
            "CON.md",
        ] {
            assert_eq!(resolve(&doc(), reference), None, "{reference}");
        }
    }

    #[test]
    fn images_are_typed_bounded_and_regular_files() {
        let dir = tempfile::tempdir().unwrap();
        let png = dir.path().join("a.PNG");
        std::fs::write(&png, b"\x89PNG").unwrap();
        assert_eq!(read_image(&png), Ok((b"\x89PNG".to_vec(), "image/png")));
        let svg = dir.path().join("b.svg");
        std::fs::write(&svg, b"<svg/>").unwrap();
        assert_eq!(read_image(&svg).unwrap().1, "image/svg+xml");
        assert_eq!(
            read_image(&dir.path().join("c.html")),
            Err("unsupported-type")
        );
        assert_eq!(
            read_image(&dir.path().join("missing.png")),
            Err("unreadable")
        );
        let big = dir.path().join("big.gif");
        let file = std::fs::File::create(&big).unwrap();
        file.set_len(MAX_IMAGE_BYTES + 1).unwrap();
        assert_eq!(read_image(&big), Err("too-large"));
        assert_eq!(
            with_markdown_extension(PathBuf::from(r"C:\a\Notes")),
            PathBuf::from(r"C:\a\Notes.md")
        );
        assert_eq!(
            with_markdown_extension(PathBuf::from(r"C:\a\b.markdown")),
            PathBuf::from(r"C:\a\b.markdown")
        );
    }

    #[test]
    fn links_open_markdown_targets_only() {
        for name in ["a.md", "b.MARKDOWN", "c"] {
            assert!(
                is_markdown_target(&with_markdown_extension(PathBuf::from(name))),
                "{name}"
            );
        }
        for name in [
            "settings.json",
            "x.jsonl",
            "notes.txt",
            "run.LOG",
            "a.md.json",
        ] {
            assert!(
                !is_markdown_target(&with_markdown_extension(PathBuf::from(name))),
                "{name}"
            );
        }
    }
}
