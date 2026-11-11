//! Process-lifetime capabilities for documents admitted by the native open boundary.

use std::collections::HashMap;
use std::fs::File;
use std::path::PathBuf;

use serde::Serialize;
use sha2::{Digest, Sha256};

pub use crate::file_policy::{Encoding, Eol, FileIdentity};
use crate::file_policy::{ReadRevision, MAX_BATCH_FILES};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct Token(String);

impl Token {
    /// Accept only the exact shape `register` issues: 32 lowercase hex digits.
    pub fn parse(value: &str) -> Option<Self> {
        (value.len() == 32
            && value
                .bytes()
                .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')))
        .then(|| Self(value.to_owned()))
    }
}

// Later save commands consume the captured revision; opens only populate it today.
#[allow(dead_code)]
#[derive(Debug)]
pub struct Binding {
    pub path: PathBuf,
    pub identity: Option<FileIdentity>,
    pub digest: [u8; 32],
    pub len: u64,
    pub encoding: Encoding,
    pub eol: Eol,
    pub generation: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum RegisterError {
    Capacity,
    RandomnessUnavailable,
}

#[derive(Default)]
pub struct Registry {
    bindings: HashMap<Token, Binding>,
}

impl Registry {
    pub fn register(&mut self, binding: Binding) -> Result<Token, RegisterError> {
        if self.bindings.len() >= MAX_BATCH_FILES {
            return Err(RegisterError::Capacity);
        }
        loop {
            let mut bytes = [0; 16];
            getrandom::fill(&mut bytes).map_err(|_| RegisterError::RandomnessUnavailable)?;
            let token = Token(bytes.iter().map(|byte| format!("{byte:02x}")).collect());
            // Never replace a live binding, even in the event of a token collision.
            if !self.bindings.contains_key(&token) {
                self.bindings.insert(token.clone(), binding);
                return Ok(token);
            }
        }
    }

    // Save lookup is deliberately not exposed through IPC in this slice.
    #[allow(dead_code)]
    pub fn get(&self, token: &Token) -> Option<&Binding> {
        self.bindings.get(token)
    }

    // Close/revocation IPC arrives in a later slice.
    #[allow(dead_code)]
    pub fn get_mut(&mut self, token: &Token) -> Option<&mut Binding> {
        self.bindings.get_mut(token)
    }

    pub fn revoke(&mut self, token: &Token) {
        self.bindings.remove(token);
    }

    // Retained for bounded-state inspection and later lifecycle commands.
    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.bindings.len()
    }
}

pub fn capture_revision(file: &File, raw: &[u8]) -> ReadRevision {
    ReadRevision {
        digest: Sha256::digest(raw).into(),
        identity: file_identity(file),
    }
}

#[cfg(windows)]
fn file_identity(file: &File) -> Option<FileIdentity> {
    use std::mem::{size_of, MaybeUninit};
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FileIdInfo, GetFileInformationByHandleEx, FILE_ID_INFO,
    };

    let mut info = MaybeUninit::<FILE_ID_INFO>::uninit();
    // SAFETY: file owns a live handle throughout this call; info is writable for
    // the exact FILE_ID_INFO size and is only read after Windows reports success.
    let success = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileIdInfo,
            info.as_mut_ptr().cast(),
            size_of::<FILE_ID_INFO>() as u32,
        )
    };
    if success == 0 {
        return None;
    }
    // SAFETY: the successful FileIdInfo query initialized the complete structure.
    let info = unsafe { info.assume_init() };
    Some(FileIdentity {
        volume_serial: info.VolumeSerialNumber,
        file_id: info.FileId.Identifier,
    })
}

#[cfg(not(windows))]
fn file_identity(_: &File) -> Option<FileIdentity> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_policy::{read_batch, MAX_FILE_BYTES};

    fn binding(path: PathBuf) -> Binding {
        Binding {
            path,
            identity: None,
            digest: [0; 32],
            len: 0,
            encoding: Encoding::Utf8,
            eol: Eol::None,
            generation: 0,
        }
    }

    #[test]
    fn tokens_are_128_bit_lowercase_hex_and_unique_even_for_duplicate_paths() {
        let mut registry = Registry::default();
        let path = PathBuf::from("same.md");
        let mut tokens = std::collections::HashSet::new();
        for _ in 0..MAX_BATCH_FILES {
            let token = registry.register(binding(path.clone())).unwrap();
            assert_eq!(token.0.len(), 32);
            assert!(token
                .0
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)));
            assert_eq!(registry.get(&token).unwrap().path, path);
            assert!(tokens.insert(token));
        }
        assert_eq!(registry.len(), MAX_BATCH_FILES);
    }

    #[test]
    fn capacity_refuses_without_evicting_and_revocation_releases_a_slot() {
        let mut registry = Registry::default();
        let tokens: Vec<_> = (0..MAX_BATCH_FILES)
            .map(|i| {
                registry
                    .register(binding(PathBuf::from(format!("{i}.md"))))
                    .unwrap()
            })
            .collect();
        assert_eq!(
            registry.register(binding(PathBuf::from("overflow.md"))),
            Err(RegisterError::Capacity)
        );
        assert_eq!(registry.len(), MAX_BATCH_FILES);
        for token in &tokens {
            assert!(registry.get(token).is_some());
        }
        registry.revoke(&tokens[0]);
        registry.revoke(&tokens[0]);
        assert!(registry.get(&tokens[0]).is_none());
        assert_eq!(registry.len(), MAX_BATCH_FILES - 1);
        assert!(registry.register(binding(PathBuf::from("new.md"))).is_ok());
        assert_eq!(registry.len(), MAX_BATCH_FILES);
    }

    #[test]
    fn raw_digest_includes_the_bom_before_decoding() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("bom.md");
        std::fs::write(&path, b"\xef\xbb\xbfabc").unwrap();
        let doc =
            crate::file_policy::read_markdown(&path, MAX_FILE_BYTES, capture_revision).unwrap();
        assert_eq!(doc.text, "abc");
        assert_eq!(doc.encoding, Encoding::Utf8Bom);
        assert_eq!(doc.bytes, 6);
        assert_eq!(doc.path, path);
        // SHA-256 of EF BB BF 61 62 63, independently computed fixture.
        assert_eq!(
            doc.digest,
            [
                28, 40, 220, 63, 31, 128, 74, 26, 217, 201, 180, 180, 207, 94, 38, 88, 209, 106,
                212, 237, 8, 227, 2, 13, 4, 168, 210, 134, 80, 24, 148, 124
            ]
        );
        assert_ne!(doc.digest, <[u8; 32]>::from(Sha256::digest(b"abc")));
    }

    #[cfg(windows)]
    #[test]
    fn reads_capture_equal_identity_for_the_same_file_and_distinct_identity_for_another() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("one.md");
        let other = directory.path().join("two.md");
        std::fs::write(&path, b"same bytes").unwrap();
        std::fs::write(&other, b"same bytes").unwrap();
        let batch = read_batch([path.clone(), path, other], capture_revision);
        assert!(batch.errors.is_empty());
        let ids: Vec<_> = batch
            .documents
            .iter()
            .map(|doc| {
                doc.identity
                    .expect("local Windows filesystem supports FileIdInfo")
            })
            .collect();
        assert_eq!(ids[0], ids[1]);
        assert_ne!(ids[0], ids[2]);
    }
}
