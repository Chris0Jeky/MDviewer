//! Validation for explicit native exports. No caller-supplied destination path is accepted.
use std::path::Path;

pub const MAX_EXPORT_BYTES: usize = 128 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum ExportKind {
    Markdown,
    Pdf,
}

pub fn export_name(name: &str) -> Result<ExportKind, &'static str> {
    if name.is_empty()
        || name.encode_utf16().count() > 255
        || name.ends_with([' ', '.'])
        || name
            .chars()
            .any(|value| value.is_control() || "<>:\"/\\|?*".contains(value))
    {
        return Err("Use a valid Markdown or PDF filename without a directory path.");
    }
    let stem = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end()
        .to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
    {
        return Err("This filename is reserved by Windows. Choose another name.");
    }
    match name
        .rsplit_once('.')
        .map(|(_, extension)| extension)
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "md" | "markdown" => Ok(ExportKind::Markdown),
        "pdf" => Ok(ExportKind::Pdf),
        _ => Err("Only Markdown and PDF exports are supported."),
    }
}

pub fn export_size(bytes: usize) -> Result<(), &'static str> {
    if bytes > MAX_EXPORT_BYTES {
        Err("This export exceeds 128 MiB. For a large PDF, use Print / Save as PDF.")
    } else {
        Ok(())
    }
}

pub fn export_data(kind: ExportKind, bytes: &[u8]) -> Result<(), &'static str> {
    export_size(bytes.len())?;
    match kind {
        ExportKind::Markdown => {
            if bytes.contains(&0) || std::str::from_utf8(bytes).is_err() {
                Err("Markdown exports must contain UTF-8 text.")
            } else {
                Ok(())
            }
        }
        ExportKind::Pdf if bytes.starts_with(b"%PDF-") => Ok(()),
        ExportKind::Pdf => Err("The export is not a PDF document."),
    }
}

pub fn export_destination(path: &Path, kind: ExportKind) -> Result<(), &'static str> {
    if !path.is_absolute() {
        return Err("Choose an absolute destination in the Save dialog.");
    }
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("Choose a valid destination filename.")?;
    if export_name(name)? != kind {
        return Err("Keep the selected export's Markdown or PDF file extension.");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_unicode_and_spaces_in_safe_document_names() {
        for name in ["a.md", "a.MARKDOWN", "café 文件.md", "a document.md"] {
            assert_eq!(export_name(name), Ok(ExportKind::Markdown));
        }
        assert_eq!(export_name("research.PDF"), Ok(ExportKind::Pdf));
    }

    #[test]
    fn rejects_paths_windows_devices_and_ambiguous_names() {
        for name in [
            "../a.md",
            "a/b.md",
            "a\\b.md",
            "C:\\a.md",
            "C:a.md",
            "NUL.md",
            "con.pdf",
            "COM1.md",
            "LPT9.md",
            "a.md ",
            "a.md.",
            "a\n.md",
            "a:stream.md",
            "a.pdf.exe",
            "a.svg",
            "md",
            "pdf",
            "",
        ] {
            assert!(export_name(name).is_err(), "accepted {name:?}");
        }
        assert!(export_name(&format!("{}.md", "😀".repeat(127))).is_err());
    }

    #[test]
    fn accepts_the_exact_limit_and_rejects_the_next_byte_without_allocating_it() {
        assert!(export_size(0).is_ok());
        assert!(export_size(MAX_EXPORT_BYTES).is_ok());
        assert!(export_size(MAX_EXPORT_BYTES + 1).is_err());
    }

    #[test]
    fn checks_utf8_source_and_pdf_signature() {
        assert!(export_data(ExportKind::Markdown, "# café\n".as_bytes()).is_ok());
        assert!(export_data(ExportKind::Markdown, b"").is_ok());
        assert!(export_data(ExportKind::Markdown, b"bad\0text").is_err());
        assert!(export_data(ExportKind::Markdown, &[255]).is_err());
        assert!(export_data(ExportKind::Pdf, b"%PDF-1.7\n").is_ok());
        assert!(export_data(ExportKind::Pdf, b"not a PDF").is_err());
    }

    #[test]
    fn destination_keeps_the_selected_document_format() {
        let directory = std::env::temp_dir();
        assert!(export_destination(&directory.join("a.md"), ExportKind::Markdown).is_ok());
        assert!(export_destination(&directory.join("a.markdown"), ExportKind::Markdown).is_ok());
        assert!(export_destination(&directory.join("a.pdf"), ExportKind::Pdf).is_ok());
        assert!(export_destination(Path::new("a.md"), ExportKind::Markdown).is_err());
        assert!(export_destination(&directory.join("a.exe"), ExportKind::Pdf).is_err());
        assert!(export_destination(&directory.join("a.md"), ExportKind::Pdf).is_err());
    }
}
