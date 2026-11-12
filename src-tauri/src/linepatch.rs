//! Byte-exact line patches for actionable Markdown (docs/design/ACTIONABLE_MARKDOWN.md,
//! "Write-back"). The file is split into lines over its raw code units (UTF-8 bytes,
//! or UTF-16 LE/BE units after a byte order mark), keeping every line terminator as
//! written. Only the content of placed lines changes; the BOM, each terminator
//! (mixed endings included) and the presence of a final terminator are untouched.

use serde::Deserialize;

/// One line patch: the full old text of the line and its full new text.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Patch {
    /// The 0-based line the reader last saw this control on.
    pub line: usize,
    /// The control's `<!-- id: name -->` name, when it has one. Native placement
    /// does not use it; the parser does when it re-derives an unplaced patch.
    #[serde(default)]
    #[allow(dead_code)]
    pub id: Option<String>,
    pub expect: String,
    pub replace: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum PatchError {
    /// The file is not UTF-8 or UTF-16 with a BOM.
    Encoding,
    /// A replacement contains a line break, or a patch is malformed.
    Invalid(usize),
    /// This patch could not be placed after an outside change; nothing was written.
    Unplaced(usize),
}

pub const MAX_PATCHES: usize = 256;
pub const MAX_LINE_CHARS: usize = 65_536;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Codec {
    Utf8,
    Utf16Le,
    Utf16Be,
}

impl Codec {
    fn width(self) -> usize {
        if self == Codec::Utf8 {
            1
        } else {
            2
        }
    }
    fn unit(self, bytes: &[u8], at: usize) -> u16 {
        match self {
            Codec::Utf8 => bytes[at] as u16,
            Codec::Utf16Le => u16::from_le_bytes([bytes[at], bytes[at + 1]]),
            Codec::Utf16Be => u16::from_be_bytes([bytes[at], bytes[at + 1]]),
        }
    }
    fn decode(self, bytes: &[u8]) -> Option<String> {
        match self {
            Codec::Utf8 => std::str::from_utf8(bytes).ok().map(str::to_owned),
            _ => {
                let units: Vec<u16> = (0..bytes.len() / 2)
                    .map(|i| self.unit(bytes, i * 2))
                    .collect();
                String::from_utf16(&units).ok()
            }
        }
    }
    fn encode(self, text: &str) -> Vec<u8> {
        match self {
            Codec::Utf8 => text.as_bytes().to_vec(),
            Codec::Utf16Le => text.encode_utf16().flat_map(u16::to_le_bytes).collect(),
            Codec::Utf16Be => text.encode_utf16().flat_map(u16::to_be_bytes).collect(),
        }
    }
}

/// A file as (BOM, [(content, terminator)]) over raw bytes.
struct Lines<'a> {
    codec: Codec,
    bom: &'a [u8],
    lines: Vec<(&'a [u8], &'a [u8])>,
}

fn split(raw: &[u8]) -> Result<Lines<'_>, PatchError> {
    let (codec, bom_len) = if raw.starts_with(&[0xef, 0xbb, 0xbf]) {
        (Codec::Utf8, 3)
    } else if raw.starts_with(&[0xff, 0xfe]) {
        (Codec::Utf16Le, 2)
    } else if raw.starts_with(&[0xfe, 0xff]) {
        (Codec::Utf16Be, 2)
    } else {
        (Codec::Utf8, 0)
    };
    let (bom, body) = raw.split_at(bom_len);
    let width = codec.width();
    if body.len() % width != 0 {
        return Err(PatchError::Encoding);
    }
    let mut lines = Vec::new();
    let (mut start, mut at) = (0, 0);
    while at < body.len() {
        let unit = codec.unit(body, at);
        if unit == 0x0A || unit == 0x0D {
            let mut end = at + width;
            if unit == 0x0D && end < body.len() && codec.unit(body, end) == 0x0A {
                end += width;
            }
            lines.push((&body[start..at], &body[at..end]));
            start = end;
            at = end;
        } else {
            at += width;
        }
    }
    // The last line has no terminator (possibly empty when the file ends with one).
    lines.push((&body[start..], &body[body.len()..]));
    // Every line must decode, so comparisons and the returned text are exact.
    if lines
        .iter()
        .any(|(content, _)| codec.decode(content).is_none())
    {
        return Err(PatchError::Encoding);
    }
    Ok(Lines { codec, bom, lines })
}

/// The file's text exactly as written (terminators kept), or None if not UTF-8/UTF-16.
pub fn text_of(raw: &[u8]) -> Option<String> {
    let doc = split(raw).ok()?;
    let mut text = String::new();
    for (content, terminator) in &doc.lines {
        text.push_str(&doc.codec.decode(content)?);
        text.push_str(&doc.codec.decode(terminator)?);
    }
    Some(text)
}

/// Place every patch on the current bytes and return the new bytes and their text.
/// All-or-nothing: any unplaceable or invalid patch fails the whole change.
pub fn apply(raw: &[u8], patches: &[Patch]) -> Result<(Vec<u8>, String), PatchError> {
    if patches.is_empty() || patches.len() > MAX_PATCHES {
        return Err(PatchError::Invalid(0));
    }
    let doc = split(raw)?;
    let texts: Vec<String> = doc
        .lines
        .iter()
        .map(|(content, _)| doc.codec.decode(content).unwrap_or_default())
        .collect();
    let mut new_texts: Vec<Option<String>> = vec![None; texts.len()];
    for (index, patch) in patches.iter().enumerate() {
        let bad = |s: &str| s.contains(['\n', '\r', '\0']) || s.chars().count() > MAX_LINE_CHARS;
        if bad(&patch.replace) || bad(&patch.expect) {
            return Err(PatchError::Invalid(index));
        }
        // Only the remembered line, and only while it still holds exactly the expected
        // text. Everything else (the contract's id and equal-line steps) needs the
        // Markdown syntax, so it is the parser's: it re-derives from the returned text.
        let placed = (texts.get(patch.line) == Some(&patch.expect)
            && new_texts[patch.line].is_none())
        .then(|| (patch.line, patch.replace.clone()));
        let Some((line, text)) = placed else {
            return Err(PatchError::Unplaced(index));
        };
        new_texts[line] = Some(text);
    }
    let mut bytes = doc.bom.to_vec();
    let mut text = String::new();
    for (i, (content, terminator)) in doc.lines.iter().enumerate() {
        match &new_texts[i] {
            Some(new) => {
                bytes.extend(doc.codec.encode(new));
                text.push_str(new);
            }
            None => {
                bytes.extend_from_slice(content);
                text.push_str(&texts[i]);
            }
        }
        bytes.extend_from_slice(terminator);
        text.push_str(&doc.codec.decode(terminator).unwrap_or_default());
    }
    Ok((bytes, text))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patch(line: usize, id: Option<&str>, expect: &str, replace: &str) -> Patch {
        Patch {
            line,
            id: id.map(str::to_owned),
            expect: expect.into(),
            replace: replace.into(),
        }
    }

    fn utf16(bom_le: bool, text: &str) -> Vec<u8> {
        let mut out = if bom_le {
            vec![0xff, 0xfe]
        } else {
            vec![0xfe, 0xff]
        };
        for unit in text.encode_utf16() {
            out.extend(if bom_le {
                unit.to_le_bytes()
            } else {
                unit.to_be_bytes()
            });
        }
        out
    }

    /// The webview's published conformance fixtures (tests/fixtures/actionable): the patches
    /// it plans, applied natively, must write exactly the bytes the fixture lists. Both ends
    /// run these, so their line numbering cannot drift apart again (#266).
    #[test]
    fn applies_the_shared_conformance_fixtures_byte_exact() {
        #[derive(Deserialize)]
        struct Change {
            name: String,
            patches: Vec<Patch>,
            after: String,
        }
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/actionable");
        let mut checked = 0;
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()).and_then(|n| n.strip_suffix(".patches.json")) else {
                continue;
            };
            let source = std::fs::read(dir.join(format!("{name}.md"))).unwrap();
            let changes: Vec<Change> =
                serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            for change in changes {
                let (bytes, _) = apply(&source, &change.patches)
                    .unwrap_or_else(|error| panic!("{name}: {}: {error:?}", change.name));
                assert_eq!(
                    String::from_utf8(bytes).unwrap(),
                    change.after,
                    "{name}: {}",
                    change.name
                );
                checked += 1;
            }
        }
        assert!(checked >= 6, "the fixtures were found ({checked} changes)");
    }

    #[test]
    fn only_the_patched_line_changes_in_every_encoding_and_ending_mix() {
        let source = "# Tasks\r\n- [ ] one <!-- id: a -->\n- [ ] two\rtail é";
        let expected = "# Tasks\r\n- [x] one <!-- id: a -->\n- [ ] two\rtail é";
        let p = [patch(
            2,
            Some("a"),
            "- [ ] one <!-- id: a -->",
            "- [x] one <!-- id: a -->",
        )];
        let utf8 = source.as_bytes().to_vec();
        let bom = [&[0xef, 0xbb, 0xbf][..], source.as_bytes()].concat();
        for (raw, want) in [
            (utf8, expected.as_bytes().to_vec()),
            (bom, [&[0xef, 0xbb, 0xbf][..], expected.as_bytes()].concat()),
            (utf16(true, source), utf16(true, expected)),
            (utf16(false, source), utf16(false, expected)),
        ] {
            let (bytes, text) = apply(&raw, &p).unwrap();
            assert_eq!(bytes, want, "whole-file bytes");
            assert_eq!(text, expected);
        }
        // A final terminator is kept exactly as it was.
        let (bytes, _) = apply(b"- [ ] x\r\n", &[patch(1, None, "- [ ] x", "- [x] x")]).unwrap();
        assert_eq!(bytes, b"- [x] x\r\n");
    }

    #[test]
    fn only_the_remembered_line_is_placed_natively() {
        let twice = b"- [ ] t\n- [ ] t\n";
        let (bytes, _) = apply(twice, &[patch(2, None, "- [ ] t", "- [x] t")]).unwrap();
        assert_eq!(bytes, b"- [ ] t\n- [x] t\n");
        // Moved (lines inserted above), renamed, or a twin left elsewhere: the parser
        // re-derives with syntax knowledge (code blocks, control kinds), never a guess.
        let moved = b"new\n- [ ] a <!-- id: a -->\n";
        assert_eq!(
            apply(
                moved,
                &[patch(
                    1,
                    Some("a"),
                    "- [ ] a <!-- id: a -->",
                    "- [x] a <!-- id: a -->"
                )]
            ),
            Err(PatchError::Unplaced(0))
        );
        let ticked_elsewhere = b"- [x] review\n- [ ] review\n";
        assert_eq!(
            apply(
                ticked_elsewhere,
                &[patch(1, None, "- [ ] review", "- [x] review")]
            ),
            Err(PatchError::Unplaced(0))
        );
        assert_eq!(
            apply(twice, &[patch(1, None, "- [ ] t", "a\0b")]),
            Err(PatchError::Invalid(0))
        );
    }

    #[test]
    fn refuses_and_writes_nothing_when_a_patch_cannot_be_placed() {
        let raw = b"- [ ] same\n- [ ] same\n";
        // Remembered line changed, no id, and the text appears twice: ambiguous.
        assert_eq!(
            apply(raw, &[patch(6, None, "- [ ] same", "- [x] same")]),
            Err(PatchError::Unplaced(0))
        );
        assert_eq!(
            apply(raw, &[patch(1, None, "- [ ] gone", "- [x] gone")]),
            Err(PatchError::Unplaced(0))
        );
        // Two lines carrying the same id are ignored for placement.
        let dup = b"- [ ] a <!-- id: x -->\n- [ ] b <!-- id: x -->\n";
        assert_eq!(
            apply(
                dup,
                &[patch(
                    10,
                    Some("x"),
                    "- [ ] c <!-- id: x -->",
                    "- [x] c <!-- id: x -->"
                )]
            ),
            Err(PatchError::Unplaced(0))
        );
        assert_eq!(
            apply(raw, &[patch(1, None, "- [ ] same", "line\nbreak")]),
            Err(PatchError::Invalid(0))
        );
        assert_eq!(
            apply(&[0xff, 0xfe, 0x41], &[patch(1, None, "A", "B")]),
            Err(PatchError::Encoding)
        );
        assert_eq!(
            apply(&[0xc3, 0x28], &[patch(1, None, "x", "y")]),
            Err(PatchError::Encoding)
        );
    }

    #[test]
    fn a_multi_patch_change_is_all_or_nothing() {
        let raw = b"( ) red <!-- id: r -->\n(x) green <!-- id: g -->\n( ) blue\n";
        let choose = [
            patch(
                1,
                Some("r"),
                "( ) red <!-- id: r -->",
                "(x) red <!-- id: r -->",
            ),
            patch(
                2,
                Some("g"),
                "(x) green <!-- id: g -->",
                "( ) green <!-- id: g -->",
            ),
        ];
        let (bytes, _) = apply(raw, &choose).unwrap();
        assert_eq!(
            bytes,
            b"(x) red <!-- id: r -->\n( ) green <!-- id: g -->\n( ) blue\n"
        );
        let broken = [
            choose[0].clone(),
            patch(3, None, "( ) purple", "(x) purple"),
        ];
        assert_eq!(apply(raw, &broken), Err(PatchError::Unplaced(1)));
        // Two patches may not claim the same line.
        let twice = [choose[0].clone(), choose[0].clone()];
        assert_eq!(apply(raw, &twice), Err(PatchError::Unplaced(1)));
    }
}
