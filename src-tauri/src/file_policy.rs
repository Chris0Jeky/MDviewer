//! The native input boundary. This module deliberately needs only the standard library,
//! so its real file/encoding/bounds tests can also run without a graphical runtime.

use std::ffi::OsString;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

pub const MAX_FILE_BYTES: u64 = 25_000_000;

/// Markdown documents. With [`DATA_EXTENSIONS`], every extension MDviewer opens and saves.
pub const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown"];
/// Data and plain-text documents (docs/design/READABLE_DATA.md, phases 1 and 2): read and saved as
/// raw text under the same path, size and encoding rules; the webview derives their view.
pub const DATA_EXTENSIONS: &[&str] = &[
    "json", "jsonc", "jsonl", "ndjson", "txt", "log", "yaml", "yml", "toml", "csv", "tsv",
];

/// The lower-case extension of `name` when it is one MDviewer opens, else None.
pub fn document_extension(name: &str) -> Option<String> {
    let extension = name.rsplit_once('.')?.1.to_ascii_lowercase();
    MARKDOWN_EXTENSIONS
        .iter()
        .chain(DATA_EXTENSIONS)
        .any(|known| *known == extension)
        .then_some(extension)
}
pub const MAX_BATCH_FILES: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding {
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
}

impl Encoding {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Utf8 => "utf-8",
            Self::Utf8Bom => "utf-8-bom",
            Self::Utf16Le => "utf-16le",
            Self::Utf16Be => "utf-16be",
        }
    }

    pub fn detect(bytes: &[u8]) -> Self {
        if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
            Self::Utf8Bom
        } else if bytes.starts_with(&[0xff, 0xfe]) {
            Self::Utf16Le
        } else if bytes.starts_with(&[0xfe, 0xff]) {
            Self::Utf16Be
        } else {
            Self::Utf8
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Eol {
    Lf,
    Crlf,
    Cr,
    Mixed,
    None,
}

impl Eol {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Lf => "lf",
            Self::Crlf => "crlf",
            Self::Cr => "cr",
            Self::Mixed => "mixed",
            Self::None => "none",
        }
    }

    pub fn detect(text: &str) -> Self {
        let mut bytes = text.bytes().peekable();
        let (mut lf, mut crlf, mut cr) = (false, false, false);
        while let Some(byte) = bytes.next() {
            match byte {
                b'\r' if bytes.peek() == Some(&b'\n') => {
                    crlf = true;
                    bytes.next();
                }
                b'\r' => cr = true,
                b'\n' => lf = true,
                _ => {}
            }
        }
        match (lf, crlf, cr) {
            (false, false, false) => Self::None,
            (true, false, false) => Self::Lf,
            (false, true, false) => Self::Crlf,
            (false, false, true) => Self::Cr,
            _ => Self::Mixed,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileIdentity {
    pub volume_serial: u64,
    pub file_id: [u8; 16],
}

// Supplied by the host from the exact raw bytes and open read handle. Keeping the
// capture callback here leaves cryptography and platform FFI outside this module.
#[derive(Debug)]
pub struct ReadRevision {
    pub digest: [u8; 32],
    pub identity: Option<FileIdentity>,
}

#[derive(Debug)]
pub struct Document {
    pub name: String,
    pub text: String,
    pub bytes: u64,
    pub path: PathBuf,
    pub digest: [u8; 32],
    pub identity: Option<FileIdentity>,
    pub encoding: Encoding,
    pub eol: Eol,
}

#[derive(Debug)]
pub struct FileError {
    pub name: String,
    pub message: String,
}

#[derive(Debug, Default)]
pub struct ReadBatch {
    pub documents: Vec<Document>,
    pub errors: Vec<FileError>,
}

#[derive(Default)]
pub struct PendingFiles {
    pub paths: Vec<PathBuf>,
    pub skipped: usize,
}

impl PendingFiles {
    pub fn enqueue(&mut self, paths: impl IntoIterator<Item = PathBuf>) {
        for path in paths {
            if self.paths.len() < MAX_BATCH_FILES {
                self.paths.push(path);
            } else {
                self.skipped = self.skipped.saturating_add(1);
            }
        }
    }
}

pub fn resolve_launch_paths(args: impl IntoIterator<Item = OsString>, cwd: &Path) -> Vec<PathBuf> {
    args.into_iter()
        .filter(|arg| arg != "--")
        .map(|arg| {
            let path = PathBuf::from(arg);
            if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            }
        })
        .collect()
}

pub fn read_batch(
    paths: impl IntoIterator<Item = PathBuf>,
    capture: impl Fn(&File, &[u8]) -> ReadRevision,
) -> ReadBatch {
    let mut batch = ReadBatch::default();
    let mut remaining = MAX_FILE_BYTES;
    let mut skipped = 0;
    for (index, path) in paths.into_iter().enumerate() {
        if index >= MAX_BATCH_FILES {
            skipped += 1;
            continue;
        }
        // A crash between the two renames of a save leaves the original aside (#249).
        crate::replace::recover_if_missing(&path);
        match read_markdown(&path, remaining, &capture) {
            Ok(document) => {
                // Limit both disk bytes and decoded UTF-8: UTF-16 can grow when decoded.
                remaining =
                    remaining.saturating_sub(document.bytes.max(document.text.len() as u64));
                batch.documents.push(document);
            }
            Err(error) => batch.errors.push(error),
        }
    }
    if skipped > 0 {
        batch.errors.push(skipped_files_error(skipped));
    }
    batch
}

pub fn skipped_files_error(count: usize) -> FileError {
    FileError {
        name: "Additional files".into(),
        message: format!("Skipped {count} additional files. Open up to 32 files at a time."),
    }
}

fn filename(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Selected file".into())
}

fn error_for(path: &Path, message: &str) -> FileError {
    FileError {
        name: filename(path),
        message: message.into(),
    }
}

// Never turn a Markdown open into a device or UNC/network request. Ordinary local
// absolute paths, including Windows' long-path disk prefix, remain supported.
pub fn is_local_file_path(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        if let Some(Component::Prefix(prefix)) = path.components().next() {
            if !matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)) {
                return false;
            }
        }
        // Drive-relative paths depend on a hidden per-drive working directory and
        // cannot be resolved reliably against a second launch's working directory.
        if path.has_root() && !path.is_absolute() {
            return false;
        }
        if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
            let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
            if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                || (stem.len() == 4
                    && (stem.starts_with("COM") || stem.starts_with("LPT"))
                    && matches!(stem.as_bytes()[3], b'1'..=b'9'))
            {
                return false;
            }
        }
    }
    path.is_absolute()
}

pub fn read_markdown(
    path: &Path,
    limit: u64,
    capture: impl FnOnce(&File, &[u8]) -> ReadRevision,
) -> Result<Document, FileError> {
    let limit = limit.min(MAX_FILE_BYTES);
    if !is_local_file_path(path) {
        return Err(error_for(
            path,
            "Choose a local file with an absolute path.",
        ));
    }
    let supported = path
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(document_extension)
        .is_some();
    if !supported {
        return Err(error_for(
            path,
            "Only Markdown, JSON, JSON Lines, YAML, TOML, CSV, TSV and plain text (.txt, .log) files are supported.",
        ));
    }
    let metadata = fs::metadata(path).map_err(|_| {
        error_for(
            path,
            "Could not read this file. Check that it exists and you have access.",
        )
    })?;
    if !metadata.is_file() {
        return Err(error_for(
            path,
            "Choose a regular file, not a folder or device.",
        ));
    }
    if metadata.len() > limit {
        return Err(error_for(
            path,
            "This selection exceeds the 25 MB limit. Open fewer or smaller files.",
        ));
    }
    let file = File::open(path).map_err(|_| {
        error_for(
            path,
            "Could not open this file. Check that you have access.",
        )
    })?;
    // Recheck the opened handle as the path could have changed after the first stat.
    let opened = file
        .metadata()
        .map_err(|_| error_for(path, "Could not inspect the opened file."))?;
    if !opened.is_file() {
        return Err(error_for(
            path,
            "Choose a regular file, not a folder or device.",
        ));
    }
    if opened.len() > limit {
        return Err(error_for(
            path,
            "This selection exceeds the 25 MB limit. Open fewer or smaller files.",
        ));
    }
    let raw = read_bounded(&file, limit).map_err(|message| error_for(path, message))?;
    let bytes = raw.len() as u64;
    let revision = capture(&file, &raw);
    let encoding = Encoding::detect(&raw);
    let text = decode_markdown(raw).map_err(|message| error_for(path, message))?;
    if text.len() as u64 > limit {
        return Err(error_for(
            path,
            "Decoded text exceeds the 25 MB limit. Open fewer or smaller files.",
        ));
    }
    Ok(Document {
        name: filename(path),
        eol: Eol::detect(&text),
        text,
        bytes,
        path: path.to_path_buf(),
        digest: revision.digest,
        identity: revision.identity,
        encoding,
    })
}

fn read_bounded(reader: impl Read, limit: u64) -> Result<Vec<u8>, &'static str> {
    let mut bytes = Vec::new();
    reader
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| "The file could not be read completely. Try opening it again.")?;
    if bytes.len() as u64 > limit {
        return Err("This selection exceeds the 25 MB limit. Open fewer or smaller files.");
    }
    Ok(bytes)
}

#[derive(Debug, PartialEq, Eq)]
pub enum EncodeError {
    /// The source mixed line endings; they cannot be rebuilt after editing.
    MixedLineEndings,
    TooLarge,
}

/// Encode editor text back to a file's original conventions, byte for byte.
///
/// Any CRLF/CR/LF in `text` is first normalised to LF (a textarea always yields
/// LF), then rewritten with the file's uniform ending. A trailing newline is
/// kept or omitted exactly as `text` has it. Mixed sources need explicit consent
/// (`accept_lf`), after which they are written as LF.
pub fn encode_markdown(
    text: &str,
    encoding: Encoding,
    eol: Eol,
    accept_lf: bool,
) -> Result<Vec<u8>, EncodeError> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let ending = match eol {
        Eol::Crlf => "\r\n",
        Eol::Cr => "\r",
        Eol::Lf | Eol::None => "\n",
        Eol::Mixed if accept_lf => "\n",
        Eol::Mixed => return Err(EncodeError::MixedLineEndings),
    };
    let body = if ending == "\n" {
        normalized
    } else {
        normalized.replace('\n', ending)
    };
    let mut bytes = match encoding {
        Encoding::Utf8 => Vec::with_capacity(body.len()),
        Encoding::Utf8Bom => vec![0xef, 0xbb, 0xbf],
        Encoding::Utf16Le => vec![0xff, 0xfe],
        Encoding::Utf16Be => vec![0xfe, 0xff],
    };
    match encoding {
        Encoding::Utf8 | Encoding::Utf8Bom => bytes.extend_from_slice(body.as_bytes()),
        Encoding::Utf16Le => body
            .encode_utf16()
            .for_each(|unit| bytes.extend_from_slice(&unit.to_le_bytes())),
        Encoding::Utf16Be => body
            .encode_utf16()
            .for_each(|unit| bytes.extend_from_slice(&unit.to_be_bytes())),
    }
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(EncodeError::TooLarge);
    }
    Ok(bytes)
}

fn decode_markdown(bytes: Vec<u8>) -> Result<String, &'static str> {
    const ENCODING_ERROR: &str =
        "This file is not valid UTF-8 or UTF-16 text. Save it as UTF-8 and try again.";
    if bytes.starts_with(&[0xff, 0xfe, 0, 0]) || bytes.starts_with(&[0, 0, 0xfe, 0xff]) {
        return Err(ENCODING_ERROR);
    }
    let text = if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let little_endian = bytes[0] == 0xff;
        let payload = &bytes[2..];
        if payload.len() % 2 != 0 {
            return Err(ENCODING_ERROR);
        }
        let units = payload
            .chunks_exact(2)
            .map(|pair| {
                if little_endian {
                    u16::from_le_bytes([pair[0], pair[1]])
                } else {
                    u16::from_be_bytes([pair[0], pair[1]])
                }
            })
            .collect::<Vec<_>>();
        String::from_utf16(&units).map_err(|_| ENCODING_ERROR)?
    } else {
        let utf8 = if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
            bytes[3..].to_vec()
        } else {
            bytes
        };
        String::from_utf8(utf8).map_err(|_| ENCODING_ERROR)?
    };
    if text.contains('\0') {
        return Err(ENCODING_ERROR);
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Cursor;
    use std::sync::atomic::{AtomicU64, Ordering};

    // The standalone policy suite tests reads without linking host dependencies.
    fn policy_revision(_: &File, _: &[u8]) -> ReadRevision {
        ReadRevision {
            digest: [0; 32],
            identity: None,
        }
    }

    fn read_markdown(path: &Path, limit: u64) -> Result<Document, FileError> {
        super::read_markdown(path, limit, policy_revision)
    }

    fn read_batch(paths: impl IntoIterator<Item = PathBuf>) -> ReadBatch {
        super::read_batch(paths, policy_revision)
    }

    static NEXT_ID: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
            let path =
                std::env::temp_dir().join(format!("mdviewer-policy-{}-{id}", std::process::id()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn write(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            fs::write(&path, bytes).unwrap();
            path
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn owned_saves_round_trip_every_encoding_and_uniform_line_ending_byte_for_byte() {
        let dir = TestDirectory::new();
        for encoding in [
            Encoding::Utf8,
            Encoding::Utf8Bom,
            Encoding::Utf16Le,
            Encoding::Utf16Be,
        ] {
            for text in [
                "",
                "caf\u{e9} \u{1f4c4}",
                "a\nb\n",
                "a\r\nb\r\n",
                "a\rb\r",
                "a\nb",
                "a\r\nb",
                "\r\n",
            ] {
                // Write the source in its real convention first, then read it back.
                let source = encode_markdown(text, encoding, Eol::detect(text), false).unwrap();
                let path = dir.write("round-trip.md", &source);
                let doc = read_markdown(&path, MAX_FILE_BYTES).unwrap();
                assert_eq!((doc.encoding, doc.eol), (encoding, Eol::detect(text)));
                // A textarea edit yields LF; saving restores the original bytes.
                let edited = doc.text.replace("\r\n", "\n").replace('\r', "\n");
                assert_eq!(
                    encode_markdown(&edited, doc.encoding, doc.eol, false).unwrap(),
                    source,
                    "{encoding:?} {text:?}"
                );
                assert_eq!(
                    encode_markdown(&doc.text, doc.encoding, doc.eol, false).unwrap(),
                    source
                );
            }
        }
    }

    #[test]
    fn mixed_line_endings_need_consent_and_then_become_lf() {
        assert_eq!(
            encode_markdown("a\r\nb\n", Encoding::Utf8, Eol::Mixed, false),
            Err(EncodeError::MixedLineEndings)
        );
        assert_eq!(
            encode_markdown("a\r\nb\nc\r", Encoding::Utf8Bom, Eol::Mixed, true).unwrap(),
            b"\xef\xbb\xbfa\nb\nc\n"
        );
        assert_eq!(
            encode_markdown(
                &"x".repeat(MAX_FILE_BYTES as usize + 1),
                Encoding::Utf8,
                Eol::None,
                false
            ),
            Err(EncodeError::TooLarge)
        );
    }

    #[test]
    fn captures_each_encoding_and_original_line_ending_style_without_normalizing() {
        let dir = TestDirectory::new();
        for (encoding, wire_encoding) in [
            (Encoding::Utf8, "utf-8"),
            (Encoding::Utf8Bom, "utf-8-bom"),
            (Encoding::Utf16Le, "utf-16le"),
            (Encoding::Utf16Be, "utf-16be"),
        ] {
            for (text, eol, wire_eol) in [
                ("", Eol::None, "none"),
                ("caf\u{e9}", Eol::None, "none"),
                ("a\nb\n", Eol::Lf, "lf"),
                ("a\r\nb\r\n", Eol::Crlf, "crlf"),
                ("a\rb\r", Eol::Cr, "cr"),
                ("a\r\nb\n", Eol::Mixed, "mixed"),
                ("a\nb\r", Eol::Mixed, "mixed"),
                ("a\rb\r\n", Eol::Mixed, "mixed"),
                ("a\r\nb\nc\rd", Eol::Mixed, "mixed"),
                ("a\nb", Eol::Lf, "lf"),
            ] {
                let mut raw = match encoding {
                    Encoding::Utf8 => vec![],
                    Encoding::Utf8Bom => vec![0xef, 0xbb, 0xbf],
                    Encoding::Utf16Le => vec![0xff, 0xfe],
                    Encoding::Utf16Be => vec![0xfe, 0xff],
                };
                match encoding {
                    Encoding::Utf8 | Encoding::Utf8Bom => raw.extend_from_slice(text.as_bytes()),
                    Encoding::Utf16Le | Encoding::Utf16Be => {
                        for unit in text.encode_utf16() {
                            raw.extend_from_slice(&if encoding == Encoding::Utf16Le {
                                unit.to_le_bytes()
                            } else {
                                unit.to_be_bytes()
                            });
                        }
                    }
                }
                let path = dir.write("metadata.md", &raw);
                let doc = read_markdown(&path, MAX_FILE_BYTES).unwrap();
                assert_eq!(doc.encoding, encoding);
                assert_eq!(doc.encoding.as_str(), wire_encoding);
                assert_eq!(doc.eol, eol);
                assert_eq!(doc.eol.as_str(), wire_eol);
                assert_eq!(doc.text, text);
                assert_eq!(doc.bytes, raw.len() as u64);
                assert_eq!(doc.path, path);
            }
        }
    }

    #[test]
    fn revision_capture_observes_the_read_handle_and_exact_raw_bytes() {
        let dir = TestDirectory::new();
        let path = dir.write("capture.md", b"\xef\xbb\xbfabc");
        let document = super::read_markdown(&path, MAX_FILE_BYTES, |file, raw| {
            assert_eq!(file.metadata().unwrap().len(), 6);
            assert_eq!(raw, b"\xef\xbb\xbfabc");
            ReadRevision {
                digest: [42; 32],
                identity: Some(FileIdentity {
                    volume_serial: 7,
                    file_id: [8; 16],
                }),
            }
        })
        .unwrap();
        assert_eq!(document.digest, [42; 32]);
        assert_eq!(
            document.identity,
            Some(FileIdentity {
                volume_serial: 7,
                file_id: [8; 16]
            })
        );
    }

    #[test]
    fn preserves_unicode_and_line_endings_with_a_bom_and_uppercase_extension() {
        let dir = TestDirectory::new();
        let path = dir.write("My résumé.MD", b"\xef\xbb\xbf# Caf\xc3\xa9\r\n\r\n");
        let document = read_markdown(&path, 25_000_000).unwrap();
        assert_eq!(document.name, "My résumé.MD");
        assert_eq!(document.text, "# Café\r\n\r\n");
        assert_eq!(document.bytes, 14);
    }

    #[test]
    fn opens_data_and_text_documents_under_the_same_rules() {
        let dir = TestDirectory::new();
        for name in [
            "a.json", "b.JSONC", "c.jsonl", "d.ndjson", "e.txt", "f.LOG", "g.yaml", "h.YML",
            "i.toml", "j.csv", "k.TSV",
        ] {
            let path = dir.write(name, b"{\"k\": 1}\r\n");
            let document = read_markdown(&path, 25_000_000).unwrap();
            assert_eq!(document.text, "{\"k\": 1}\r\n", "{name}");
        }
        // The same encoding and size rules: NUL bytes are refused, the limit holds.
        assert!(read_markdown(&dir.write("bin.json", b"{\0}"), 25_000_000).is_err());
        assert!(read_markdown(&dir.write("big.txt", b"12345"), 4).is_err());
        assert_eq!(document_extension("x.Json").as_deref(), Some("json"));
        assert_eq!(document_extension("x.YML").as_deref(), Some("yml"));
        assert_eq!(document_extension("x.xml"), None);
    }

    #[test]
    fn accepts_an_empty_markdown_file() {
        let dir = TestDirectory::new();
        let path = dir.write("empty.markdown", b"");
        let document = read_markdown(&path, 25_000_000).unwrap();
        assert_eq!(document.text, "");
        assert_eq!(document.bytes, 0);
    }

    #[test]
    fn allows_the_exact_byte_limit_and_bounds_utf16_expansion() {
        let dir = TestDirectory::new();
        let exact = dir.write("exact.md", b"1234");
        assert_eq!(read_markdown(&exact, 4).unwrap().text, "1234");
        // Three Chinese UTF-16 units become nine UTF-8 bytes, despite an
        // eight-byte file including its BOM.
        let expanded = dir.write(
            "expanded.md",
            &[0xff, 0xfe, 0x60, 0x4f, 0x60, 0x4f, 0x60, 0x4f],
        );
        assert!(read_markdown(&expanded, 8).is_err());
    }

    #[test]
    fn decodes_utf16_only_with_an_explicit_bom() {
        assert_eq!(
            decode_markdown(vec![0xff, 0xfe, 0x23, 0, 0x20, 0, 0xe9, 0]).unwrap(),
            "# é"
        );
        assert_eq!(
            decode_markdown(vec![0xfe, 0xff, 0, 0x23, 0, 0x20, 0, 0xe9]).unwrap(),
            "# é"
        );
        assert_eq!(
            decode_markdown(vec![0xff, 0xfe, 0x3d, 0xd8, 0, 0xde]).unwrap(),
            "😀"
        );
    }

    #[test]
    fn rejects_invalid_text_instead_of_replacing_bytes() {
        for bytes in [
            vec![0xff],
            vec![0xc3, 0x28],
            vec![0xff, 0xfe, 0x23],
            vec![0xfe, 0xff, 0xd8, 0],
            vec![0xff, 0xfe, 0, 0, 0x23, 0, 0, 0],
            vec![b'#', 0, b'x'],
        ] {
            assert!(decode_markdown(bytes).is_err());
        }
    }

    #[test]
    fn rejects_non_markdown_files_and_directories() {
        let dir = TestDirectory::new();
        for name in ["notes.xml", "notes.md.exe", "notes.json.bak", "notes"] {
            let path = dir.write(name, b"# Valid text");
            assert!(read_markdown(&path, 25_000_000).is_err());
        }
        let path = dir.0.join("folder.md");
        fs::create_dir(&path).unwrap();
        assert!(read_markdown(&path, 25_000_000).is_err());
    }

    #[test]
    fn refuses_oversize_metadata_before_allocating_the_file() {
        let dir = TestDirectory::new();
        let path = dir.write("large.md", b"");
        fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(25_000_001)
            .unwrap();
        let error = read_markdown(&path, 25_000_000).unwrap_err();
        assert_eq!(error.name, "large.md");
        assert!(error.message.contains("25 MB"));
        assert!(read_markdown(&path, u64::MAX).is_err());
    }

    #[test]
    fn bounds_the_actual_read_even_when_metadata_was_stale() {
        let mut reader = Cursor::new(b"123456789".as_slice());
        assert!(read_bounded(&mut reader, 4).is_err());
        assert_eq!(reader.position(), 5);
        assert_eq!(read_bounded(Cursor::new(b"1234"), 4).unwrap(), b"1234");
    }

    #[test]
    fn keeps_each_launch_argument_intact_and_uses_the_callers_working_directory() {
        let cwd = std::env::temp_dir().join("caller directory");
        let absolute = cwd.join("already absolute.md");
        let paths = resolve_launch_paths(
            [
                OsString::from("--"),
                OsString::from("My file.md"),
                absolute.clone().into_os_string(),
            ],
            &cwd,
        );
        assert_eq!(paths, vec![cwd.join("My file.md"), absolute]);
    }

    #[test]
    fn a_bad_file_does_not_hide_the_other_selected_documents() {
        let dir = TestDirectory::new();
        let good = dir.write("good.md", b"# Hello");
        let bad = dir.write("bad.md", &[0xff]);
        let batch = read_batch([bad, good]);
        assert_eq!(batch.documents.len(), 1);
        assert_eq!(batch.documents[0].text, "# Hello");
        assert_eq!(batch.errors.len(), 1);
        assert_eq!(batch.errors[0].name, "bad.md");
    }

    #[test]
    fn a_batch_cannot_expand_the_read_limit_by_selecting_many_small_files() {
        let dir = TestDirectory::new();
        let first = dir.write("first.md", &vec![b'x'; 13_000_000]);
        let second = dir.write("second.md", &vec![b'y'; 13_000_000]);
        let batch = read_batch([first, second]);
        assert_eq!(batch.documents.len(), 1);
        assert_eq!(batch.errors.len(), 1);
        assert_eq!(batch.errors[0].name, "second.md");
    }

    #[test]
    fn limits_one_batch_to_32_files_and_reports_the_remainder() {
        let dir = TestDirectory::new();
        let paths = (0..34)
            .map(|i| dir.write(&format!("{i}.md"), b"# One"))
            .collect::<Vec<_>>();
        let batch = read_batch(paths);
        assert_eq!(batch.documents.len(), 32);
        assert_eq!(batch.errors.len(), 1);
        assert!(batch.errors[0].message.contains('2'));
    }

    #[test]
    fn the_pending_queue_drains_once_and_does_not_grow_without_bound() {
        let mut queue = PendingFiles::default();
        queue.enqueue((0..35).map(|i| PathBuf::from(format!("{i}.md"))));
        let drained = std::mem::take(&mut queue);
        assert_eq!(drained.paths.len(), 32);
        assert_eq!(drained.skipped, 3);
        assert!(queue.paths.is_empty());
        assert_eq!(queue.skipped, 0);
    }

    #[cfg(windows)]
    #[test]
    fn windows_paths_allow_local_disks_but_not_devices_or_unc_requests() {
        for path in [r"C:\notes with spaces.md", r"\\?\C:\long folder\notes.md"] {
            assert!(is_local_file_path(Path::new(path)));
        }
        for path in [
            r"\\server\share\notes.md",
            r"\\?\UNC\server\share\notes.md",
            r"\\.\NUL.md",
            r"C:relative.md",
            r"C:\CON.md",
            r"C:\LPT1.md",
        ] {
            assert!(!is_local_file_path(Path::new(path)));
        }
    }
}
