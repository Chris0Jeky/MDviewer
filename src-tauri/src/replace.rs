//! Experimental Windows compare-and-replace; deliberately not connected to IPC.
//! See the native README for scope, recovery policy, and the process race proof.

use std::{
    fmt, io,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub volume_serial: u64,
    pub file_id: [u8; 16],
    pub digest: [u8; 32],
    pub len: u64,
}

#[derive(Debug)]
pub enum ReplaceOutcome {
    Replaced(Snapshot),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConflictKind {
    Changed,
    Missing,
    Replaced,
    Locked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    Open,
    Verify,
    WriteTemp,
    Flush,
    RenameAside,
    RenameIntoPlace,
    Cleanup,
}

#[derive(Debug)]
pub enum ReplaceError {
    Conflict(ConflictKind),
    Io(io::ErrorKind, Stage),
    // The reason is for Debug output only; Display never exposes it.
    #[allow(dead_code)]
    Unsupported(&'static str),
}

impl fmt::Display for ReplaceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Conflict(kind) => write!(f, "File conflict: {kind:?}"),
            Self::Io(kind, stage) => write!(f, "File operation failed: {stage:?} ({kind:?})"),
            // Do not expose even a caller-constructed Unsupported message.
            Self::Unsupported(_) => f.write_str("Unsupported file or filesystem"),
        }
    }
}
impl std::error::Error for ReplaceError {}

#[cfg(windows)]
#[allow(unused_imports)] // S1a is intentionally not wired into production IPC.
pub use win::{create_new, recover_journal, replace_if_unchanged, snapshot_read};

#[cfg(not(windows))]
pub fn snapshot_read(_: &Path, _: u64) -> io::Result<(Snapshot, Vec<u8>)> {
    Err(io::ErrorKind::Unsupported.into())
}
#[cfg(not(windows))]
pub fn replace_if_unchanged(
    _: &Path,
    _: &Snapshot,
    _: &[u8],
) -> Result<ReplaceOutcome, ReplaceError> {
    Err(ReplaceError::Unsupported("Windows only"))
}
#[cfg(not(windows))]
pub fn create_new(_: &Path, _: &[u8]) -> Result<ReplaceOutcome, ReplaceError> {
    Err(ReplaceError::Unsupported("Windows only"))
}
#[cfg(not(windows))]
pub fn recover_journal(_: &Path) -> io::Result<Vec<PathBuf>> {
    Err(io::ErrorKind::Unsupported.into())
}

// SHA-256 of the raw bytes (including BOM and line endings), matching the
// registry's open-time digest.
#[cfg(any(windows, test))]
fn digest(bytes: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).into()
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::{
        ffi::OsString,
        fs::{self, File, OpenOptions},
        io::{Read, Seek, SeekFrom, Write},
        mem::{offset_of, size_of},
        os::windows::{
            ffi::{OsStrExt, OsStringExt},
            fs::OpenOptionsExt,
            io::AsRawHandle,
        },
        path::{Component, Prefix},
        sync::atomic::{AtomicU64, Ordering},
    };
    use windows_sys::Win32::{Foundation::*, Storage::FileSystem::*};
    use windows_sys::{
        Wdk::Storage::FileSystem::{
            FileRenameInformation, NtSetInformationFile, FILE_RENAME_INFORMATION,
        },
        Win32::System::IO::IO_STATUS_BLOCK,
    };

    fn err(e: io::Error, stage: Stage) -> ReplaceError {
        match e.raw_os_error().map(|n| n as u32) {
            Some(ERROR_SHARING_VIOLATION | ERROR_LOCK_VIOLATION) => {
                ReplaceError::Conflict(ConflictKind::Locked)
            }
            Some(ERROR_ACCESS_DENIED) if stage == Stage::Open => {
                ReplaceError::Conflict(ConflictKind::Locked)
            }
            Some(ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND) => {
                ReplaceError::Conflict(ConflictKind::Missing)
            }
            Some(ERROR_ALREADY_EXISTS | ERROR_FILE_EXISTS) => {
                ReplaceError::Conflict(ConflictKind::Replaced)
            }
            _ => ReplaceError::Io(e.kind(), stage),
        }
    }
    fn as_io(e: ReplaceError) -> io::Error {
        let kind = match e {
            ReplaceError::Unsupported(_) => io::ErrorKind::Unsupported,
            ReplaceError::Io(k, _) => k,
            ReplaceError::Conflict(_) => io::ErrorKind::WouldBlock,
        };
        io::Error::new(kind, e)
    }
    fn bool_result(ok: i32) -> io::Result<()> {
        if ok == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    // Reject aliases, ADS, DOS devices, ambiguous Win32 normalization and all
    // non-drive prefixes BEFORE calling the OS (never probe a UNC/device path).
    fn checked_path(path: &Path) -> Result<PathBuf, ReplaceError> {
        let mut parts = path.components();
        if !matches!(parts.next(), Some(Component::Prefix(p)) if matches!(p.kind(), Prefix::Disk(_)))
            || !matches!(parts.next(), Some(Component::RootDir))
        {
            return Err(ReplaceError::Unsupported(
                "absolute DOS drive path required",
            ));
        }
        for part in parts {
            let Component::Normal(name) = part else {
                return Err(ReplaceError::Unsupported("path alias"));
            };
            let units: Vec<_> = name.encode_wide().collect();
            let text = name.to_string_lossy();
            let stem = text.split('.').next().unwrap_or("").to_ascii_uppercase();
            if units
                .iter()
                .any(|&c| c < 32 || b"<>:\"|?*".contains(&(c as u8)) && c < 128)
                || text.ends_with(['.', ' '])
                || matches!(
                    stem.as_str(),
                    "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
                )
                || (stem.len() == 4
                    && (stem.starts_with("COM") || stem.starts_with("LPT"))
                    && matches!(stem.as_bytes()[3], b'1'..=b'9'))
            {
                return Err(ReplaceError::Unsupported("path alias or device"));
            }
        }
        if path
            .file_name()
            .is_some_and(|n| n.to_string_lossy().starts_with(".mdv-replace-"))
        {
            return Err(ReplaceError::Unsupported("reserved transaction namespace"));
        }
        // Use an extended DOS path internally, after validating ordinary syntax.
        let normalized: PathBuf = path.components().collect();
        let mut internal = OsString::from(r"\\?\");
        internal.push(normalized);
        Ok(PathBuf::from(internal))
    }
    fn info(file: &File) -> io::Result<BY_HANDLE_FILE_INFORMATION> {
        let mut out = BY_HANDLE_FILE_INFORMATION::default();
        // SAFETY: valid owned handle and correctly sized writable structure.
        bool_result(unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut out) })?;
        Ok(out)
    }
    fn regular(file: &File) -> Result<(), ReplaceError> {
        let i = info(file).map_err(|e| err(e, Stage::Verify))?;
        if i.dwFileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY) != 0 {
            return Err(ReplaceError::Unsupported("reparse point or non-file"));
        }
        if i.nNumberOfLinks != 1 {
            return Err(ReplaceError::Unsupported("multiple hard links"));
        }
        Ok(())
    }
    fn open(path: &Path) -> io::Result<File> {
        OpenOptions::new()
            .access_mode(GENERIC_READ | DELETE)
            .share_mode(FILE_SHARE_READ)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
            .open(path)
    }
    struct Parents {
        path: PathBuf,
        _handles: Vec<File>,
    }
    impl Parents {
        fn hold(path: &Path) -> Result<Self, ReplaceError> {
            let internal = checked_path(path)?;
            let root = wide(ancestors_root(&internal));
            // SAFETY: terminated path. Reject mapped network drives BEFORE opens.
            if unsafe { GetDriveTypeW(root.as_ptr()) } != 3 {
                return Err(ReplaceError::Unsupported("non-fixed volume"));
            }
            let parent = internal
                .parent()
                .ok_or(ReplaceError::Unsupported("missing parent"))?;
            let mut ancestors: Vec<_> = parent.ancestors().collect();
            ancestors.reverse();
            let mut handles = Vec::new();
            for dir in ancestors {
                // Share reads only: no directory rename/delete, reparse writer,
                // or already-open write handle while traversing the next component.
                let f = OpenOptions::new()
                    .access_mode(GENERIC_READ)
                    .share_mode(FILE_SHARE_READ)
                    .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
                    .open(dir)
                    .map_err(|e| err(e, Stage::Open))?;
                let i = info(&f).map_err(|e| err(e, Stage::Verify))?;
                if i.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                    return Err(ReplaceError::Unsupported("reparse parent"));
                }
                handles.push(f);
            }
            let mut fs_name = [0u16; 32];
            // SAFETY: live directory handle, optional outputs null, bounded buffer.
            bool_result(unsafe {
                GetVolumeInformationByHandleW(
                    handles.last().unwrap().as_raw_handle(),
                    std::ptr::null_mut(),
                    0,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    fs_name.as_mut_ptr(),
                    fs_name.len() as u32,
                )
            })
            .map_err(|e| err(e, Stage::Verify))?;
            let end = fs_name
                .iter()
                .position(|&n| n == 0)
                .unwrap_or(fs_name.len());
            if !matches!(
                String::from_utf16_lossy(&fs_name[..end]).as_str(),
                "NTFS" | "ReFS"
            ) {
                return Err(ReplaceError::Unsupported("requires NTFS or ReFS"));
            }
            Ok(Self {
                path: internal,
                _handles: handles,
            })
        }
    }
    fn ancestors_root(path: &Path) -> &Path {
        path.ancestors().last().unwrap()
    }

    fn identity(file: &File) -> io::Result<(FILE_ID_INFO, u64)> {
        let i = info(file)?;
        let len = ((i.nFileSizeHigh as u64) << 32) | i.nFileSizeLow as u64;
        let mut id = FILE_ID_INFO::default();
        // SAFETY: structure matches FileIdInfo, handle stays open for the read.
        let ok = unsafe {
            GetFileInformationByHandleEx(
                file.as_raw_handle(),
                FileIdInfo,
                (&mut id as *mut FILE_ID_INFO).cast(),
                size_of::<FILE_ID_INFO>() as u32,
            )
        };
        if ok == 0 {
            let e = io::Error::last_os_error();
            if !matches!(
                e.raw_os_error().map(|n| n as u32),
                Some(ERROR_INVALID_PARAMETER | ERROR_NOT_SUPPORTED | ERROR_INVALID_FUNCTION)
            ) {
                return Err(e);
            }
            id.VolumeSerialNumber = i.dwVolumeSerialNumber as u64;
            id.FileId.Identifier[..8].copy_from_slice(
                &(((i.nFileIndexHigh as u64) << 32) | i.nFileIndexLow as u64).to_le_bytes(),
            );
        }
        Ok((id, len))
    }
    fn read_handle(file: &mut File, max: u64) -> io::Result<(Snapshot, Vec<u8>)> {
        let (id, len) = identity(file)?;
        if len > max {
            return Err(io::ErrorKind::FileTooLarge.into());
        }
        file.seek(SeekFrom::Start(0))?;
        let mut bytes = Vec::new();
        file.take(max.saturating_add(1)).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > max {
            return Err(io::ErrorKind::FileTooLarge.into());
        }
        Ok((
            Snapshot {
                volume_serial: id.VolumeSerialNumber,
                file_id: id.FileId.Identifier,
                digest: digest(&bytes),
                len: bytes.len() as u64,
            },
            bytes,
        ))
    }
    pub fn snapshot_read(path: &Path, max_bytes: u64) -> io::Result<(Snapshot, Vec<u8>)> {
        let parents = Parents::hold(path).map_err(as_io)?;
        let mut file = open(&parents.path)?;
        regular(&file).map_err(as_io)?;
        read_handle(&mut file, max_bytes)
    }
    fn same_identity(a: &Snapshot, b: &Snapshot) -> bool {
        a.volume_serial == b.volume_serial && a.file_id == b.file_id
    }
    fn verify(file: &mut File, expected: &Snapshot) -> Result<(), ReplaceError> {
        regular(file)?;
        // A read-only original can be renamed but not deleted: refuse up front
        // rather than drop the user's flag and strand an undeletable aside.
        if info(file)
            .map_err(|e| err(e, Stage::Verify))?
            .dwFileAttributes
            & FILE_ATTRIBUTE_READONLY
            != 0
        {
            return Err(ReplaceError::Conflict(ConflictKind::Locked));
        }
        let (id, _) = identity(file).map_err(|e| err(e, Stage::Verify))?;
        if id.VolumeSerialNumber != expected.volume_serial
            || id.FileId.Identifier != expected.file_id
        {
            return Err(ReplaceError::Conflict(ConflictKind::Replaced));
        }
        let (actual, _) = read_handle(file, expected.len).map_err(|e| {
            if e.kind() == io::ErrorKind::FileTooLarge {
                ReplaceError::Conflict(ConflictKind::Changed)
            } else {
                err(e, Stage::Verify)
            }
        })?;
        if !same_identity(&actual, expected) {
            return Err(ReplaceError::Conflict(ConflictKind::Replaced));
        }
        if actual != *expected {
            return Err(ReplaceError::Conflict(ConflictKind::Changed));
        }
        Ok(())
    }
    fn disposition(file: &File, delete: bool) -> io::Result<()> {
        if !delete {
            // Clearing ordinary delete disposition does NOT cancel the creation
            // flag FILE_FLAG_DELETE_ON_CLOSE. Explicitly clear its on-close state.
            let info = FILE_DISPOSITION_INFO_EX {
                Flags: FILE_DISPOSITION_FLAG_ON_CLOSE,
            };
            // SAFETY: owned handle and the matching fixed-size information class.
            return bool_result(unsafe {
                SetFileInformationByHandle(
                    file.as_raw_handle(),
                    FileDispositionInfoEx,
                    (&info as *const FILE_DISPOSITION_INFO_EX).cast(),
                    size_of::<FILE_DISPOSITION_INFO_EX>() as u32,
                )
            });
        }
        let info = FILE_DISPOSITION_INFO { DeleteFile: delete };
        // SAFETY: valid handle and matching fixed-size structure.
        bool_result(unsafe {
            SetFileInformationByHandle(
                file.as_raw_handle(),
                FileDispositionInfo,
                (&info as *const FILE_DISPOSITION_INFO).cast(),
                size_of::<FILE_DISPOSITION_INFO>() as u32,
            )
        })
    }
    fn rename(file: &File, to: &Path) -> io::Result<()> {
        let name = wide(Path::new(
            to.file_name().ok_or(io::ErrorKind::InvalidInput)?,
        ));
        let size = offset_of!(FILE_RENAME_INFORMATION, FileName) + name.len() * 2;
        // Word allocation supplies alignment for FILE_RENAME_INFO's pointer field.
        let mut storage = vec![0usize; size.div_ceil(size_of::<usize>())];
        let ptr = storage.as_mut_ptr().cast::<FILE_RENAME_INFORMATION>();
        // SAFETY: aligned, zeroed allocation with enough trailing UTF-16 storage;
        // ReplaceIfExists is FALSE; a leaf name and NULL root rename within the
        // source handle's directory, without reopening the directory for writes.
        // Kernel copies synchronously.
        unsafe {
            (*ptr).FileNameLength = ((name.len() - 1) * 2) as u32;
            std::ptr::copy_nonoverlapping(name.as_ptr(), (*ptr).FileName.as_mut_ptr(), name.len());
            let mut status = IO_STATUS_BLOCK::default();
            let code = NtSetInformationFile(
                file.as_raw_handle(),
                &mut status,
                ptr.cast(),
                size as u32,
                FileRenameInformation,
            );
            if code < 0 {
                Err(io::Error::from_raw_os_error(
                    RtlNtStatusToDosError(code) as i32
                ))
            } else {
                Ok(())
            }
        }
    }

    static NEXT: AtomicU64 = AtomicU64::new(0);
    fn unique(parent: &Path) -> PathBuf {
        let tick = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        parent.join(format!(
            ".mdv-replace-{:x}-{tick:x}-{:x}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ))
    }
    // A newly created scratch file is delete-pending until a flushed journal owns
    // it. Process exit before publication cannot leave an unrecorded temporary.
    fn scratch(path: &Path) -> io::Result<File> {
        OpenOptions::new()
            .write(true)
            .access_mode(GENERIC_READ | GENERIC_WRITE | DELETE)
            .share_mode(FILE_SHARE_READ)
            .create_new(true)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_DELETE_ON_CLOSE)
            .open(path)
    }

    #[cfg(test)]
    thread_local! { static FAULT: std::cell::Cell<Option<Stage>> = const { std::cell::Cell::new(None) }; }
    fn point(stage: Stage) -> Result<(), ReplaceError> {
        #[cfg(test)]
        {
            if FAULT.with(|f| f.get() == Some(stage)) {
                return Err(ReplaceError::Io(
                    if stage == Stage::WriteTemp {
                        io::ErrorKind::StorageFull
                    } else {
                        io::ErrorKind::PermissionDenied
                    },
                    stage,
                ));
            }
            tests::process_point(stage);
        }
        let _ = stage;
        Ok(())
    }

    // Fixed version, bounded UTF-16 leaf name and two identity/digest records.
    // Temp/aside names are derived from the journal name, never from its payload.
    fn record(name: &std::ffi::OsStr, old: Option<&Snapshot>, new: &Snapshot) -> Vec<u8> {
        let name: Vec<_> = name.encode_wide().collect();
        let mut bytes = b"MDVRPL01".to_vec();
        bytes.extend_from_slice(&(name.len() as u32).to_le_bytes());
        for unit in name {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        bytes.push(u8::from(old.is_some()));
        for snap in old.into_iter().chain(Some(new)) {
            bytes.extend_from_slice(&snap.volume_serial.to_le_bytes());
            bytes.extend_from_slice(&snap.file_id);
            bytes.extend_from_slice(&snap.digest);
            bytes.extend_from_slice(&snap.len.to_le_bytes());
        }
        bytes
    }
    fn parse(bytes: &[u8]) -> io::Result<(OsString, Option<Snapshot>, Snapshot)> {
        let bad = || io::Error::from(io::ErrorKind::InvalidData);
        if bytes.len() < 13 || &bytes[..8] != b"MDVRPL01" {
            return Err(bad());
        }
        let n = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
        if n == 0 || n > 255 || bytes.len() < 13 + n * 2 {
            return Err(bad());
        }
        let name = OsString::from_wide(
            &bytes[12..12 + n * 2]
                .as_chunks::<2>()
                .0
                .iter()
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .collect::<Vec<_>>(),
        );
        let has_old = bytes[12 + n * 2];
        if has_old > 1 || bytes.len() != 13 + n * 2 + (1 + has_old as usize) * 64 {
            return Err(bad());
        }
        if Path::new(&name).components().count() != 1
            || !matches!(
                Path::new(&name).components().next(),
                Some(Component::Normal(_))
            )
        {
            return Err(bad());
        }
        let mut snaps = bytes[13 + n * 2..]
            .as_chunks::<64>()
            .0
            .iter()
            .map(|b| Snapshot {
                volume_serial: u64::from_le_bytes(b[..8].try_into().unwrap()),
                file_id: b[8..24].try_into().unwrap(),
                digest: b[24..56].try_into().unwrap(),
                len: u64::from_le_bytes(b[56..64].try_into().unwrap()),
            });
        let old = if has_old == 1 { snaps.next() } else { None };
        Ok((name, old, snaps.next().unwrap()))
    }

    pub fn replace_if_unchanged(
        path: &Path,
        expected: &Snapshot,
        bytes: &[u8],
    ) -> Result<ReplaceOutcome, ReplaceError> {
        transact(path, Some(expected), bytes)
    }
    pub fn create_new(path: &Path, bytes: &[u8]) -> Result<ReplaceOutcome, ReplaceError> {
        transact(path, None, bytes)
    }
    fn transact(
        path: &Path,
        expected: Option<&Snapshot>,
        bytes: &[u8],
    ) -> Result<ReplaceOutcome, ReplaceError> {
        point(Stage::Open)?;
        let parents = Parents::hold(path)?;
        let dest = &parents.path;
        let mut original = if let Some(snap) = expected {
            let mut file = open(dest).map_err(|e| err(e, Stage::Open))?;
            verify(&mut file, snap)?;
            Some(file)
        } else {
            match open(dest) {
                Ok(file) => {
                    regular(&file)?;
                    return Err(ReplaceError::Conflict(ConflictKind::Replaced));
                }
                Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                Err(e) => return Err(err(e, Stage::Open)),
            }
            None
        };
        point(Stage::Verify)?;
        let base = unique(dest.parent().unwrap());
        let temp_path = base.with_extension("tmp");
        let aside_path = base.with_extension("old");
        let journal_path = base.with_extension("journal");
        let mut temp = scratch(&temp_path).map_err(|e| err(e, Stage::WriteTemp))?;
        let split = bytes.len() / 2;
        temp.write_all(&bytes[..split])
            .map_err(|e| err(e, Stage::WriteTemp))?;
        point(Stage::WriteTemp)?; // injected disk exhaustion after a partial write
        temp.write_all(&bytes[split..])
            .map_err(|e| err(e, Stage::WriteTemp))?;
        point(Stage::Flush)?;
        temp.sync_all().map_err(|e| err(e, Stage::Flush))?;
        let (new, _) =
            read_handle(&mut temp, bytes.len() as u64).map_err(|e| err(e, Stage::Verify))?;
        if new.len != bytes.len() as u64 || new.digest != digest(bytes) {
            return Err(ReplaceError::Io(io::ErrorKind::InvalidData, Stage::Verify));
        }
        let mut journal = scratch(&journal_path).map_err(|e| err(e, Stage::WriteTemp))?;
        journal
            .write_all(&record(dest.file_name().unwrap(), expected, &new))
            .map_err(|e| err(e, Stage::WriteTemp))?;
        journal.sync_all().map_err(|e| err(e, Stage::Flush))?;
        disposition(&journal, false).map_err(|e| err(e, Stage::Flush))?;
        // From here all failures leave the journal for identity-checked recovery.
        disposition(&temp, false).map_err(|e| err(e, Stage::Flush))?;
        let committed = (|| {
            point(Stage::RenameAside)?;
            if let Some(file) = original.as_mut() {
                rename(file, &aside_path).map_err(|e| err(e, Stage::RenameAside))?;
            }
            point(Stage::RenameIntoPlace)?;
            rename(&temp, dest).map_err(|e| err(e, Stage::RenameIntoPlace))
        })();
        // Past the commit point the save happened: report it. Cleanup is best
        // effort; a leftover aside/journal is reconciled by recover_one.
        let cleaned = committed.is_ok()
            && (|| {
                point(Stage::Cleanup)?;
                if let Some(file) = &original {
                    disposition(file, true).map_err(|e| err(e, Stage::Cleanup))?;
                }
                disposition(&journal, true).map_err(|e| err(e, Stage::Cleanup))
            })()
            .is_ok();
        drop(original);
        drop(temp);
        drop(journal);
        if !cleaned {
            // Best effort immediate rollback; an external claimant in the name
            // gap is NEVER overwritten. Ambiguous records remain for recovery.
            let _ = recover_one(&journal_path);
        }
        committed.map(|()| ReplaceOutcome::Replaced(new))
    }

    fn optional(path: &Path) -> io::Result<Option<File>> {
        match open(path) {
            Ok(f) => {
                regular(&f).map_err(as_io)?;
                Ok(Some(f))
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }
    fn matches(file: &mut File, snap: &Snapshot) -> io::Result<()> {
        verify(file, snap).map_err(as_io)
    }
    fn recover_one(journal_path: &Path) -> io::Result<Vec<PathBuf>> {
        let mut journal = open(journal_path)?;
        regular(&journal).map_err(as_io)?;
        let (_, bytes) = read_handle(&mut journal, 1024)?;
        let (name, old, new) = parse(&bytes)?;
        let dest = journal_path.parent().unwrap().join(name);
        // Validate the decoded leaf with the same alias/device policy. The caller
        // has already pinned ancestors; convert internal prefix for validation.
        let units: Vec<_> = dest.as_os_str().encode_wide().collect();
        let plain = PathBuf::from(OsString::from_wide(&units[4..]));
        checked_path(&plain).map_err(as_io)?;
        let temp_path = journal_path.with_extension("tmp");
        let aside_path = journal_path.with_extension("old");
        let target = optional(&dest)?;
        let mut temp = optional(&temp_path)?;
        let mut aside = optional(&aside_path)?;
        // Verify EVERY artifact before modifying any. A stale/tampered journal
        // or edited aside is a refusal, never permission to delete by pathname.
        if let Some(f) = temp.as_mut() {
            matches(f, &new)?;
        }
        if let Some(f) = aside.as_mut() {
            matches(f, old.as_ref().ok_or(io::ErrorKind::InvalidData)?)?;
        }
        let mut touched = Vec::new();
        // Any existing destination wins, including an outside claimant or a
        // post-crash edit of the committed result. Never mutate that handle.
        // But an outside claimant took the name in the rename gap: the aside
        // holds the original's bytes, so keep them as a visible sibling.
        if let (Some(t), Some(f)) = (target.as_ref(), aside.as_ref()) {
            let (id, _) = identity(t)?;
            if id.VolumeSerialNumber != new.volume_serial || id.FileId.Identifier != new.file_id {
                let kept = recovered_name(&dest);
                rename(f, &kept)?;
                touched.extend([aside_path.clone(), kept]);
                aside = None;
            }
        }
        if target.is_none() {
            if let Some(f) = aside.as_ref() {
                // No temp means the new file already took the name and was then
                // moved away: the commit stands, so never resurrect the old bytes
                // under the real name; keep them as a visible sibling instead.
                let back = if temp.is_none() {
                    recovered_name(&dest)
                } else {
                    dest.clone()
                };
                rename(f, &back)?;
                touched.extend([aside_path.clone(), back]);
                aside = None;
            } else if old.is_some() {
                return Err(io::ErrorKind::NotFound.into());
            }
        }
        if let Some(f) = aside {
            disposition(&f, true)?;
            touched.push(aside_path);
        }
        if let Some(f) = temp {
            disposition(&f, true)?;
            touched.push(temp_path);
        }
        disposition(&journal, true)?;
        touched.push(journal_path.to_owned());
        Ok(touched)
    }
    /// `name (MDviewer recovered <id>).ext`, next to `dest`; never an existing name.
    fn recovered_name(dest: &Path) -> PathBuf {
        let stem = dest.file_stem().unwrap_or_default().to_string_lossy();
        let ext = dest
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_default();
        let id = unique(Path::new(""));
        let id = id.to_string_lossy();
        let id = id.trim_start_matches(".mdv-replace-");
        dest.with_file_name(format!("{stem} (MDviewer recovered {id}){ext}"))
    }
    pub fn recover_journal(dir: &Path) -> io::Result<Vec<PathBuf>> {
        let parents = Parents::hold(&dir.join("recovery-anchor")).map_err(as_io)?;
        let mut touched = Vec::new();
        let mut first_error = None;
        for entry in fs::read_dir(parents.path.parent().unwrap())? {
            let path = entry?.path();
            let name = path.file_name().unwrap().to_string_lossy();
            if name.starts_with(".mdv-replace-") && name.ends_with(".journal") {
                // One stuck journal must not block the others in this folder.
                match recover_one(&path) {
                    Ok(paths) => touched.extend(paths),
                    Err(e) => {
                        first_error.get_or_insert(e);
                    }
                }
            }
        }
        match first_error {
            Some(e) => Err(e),
            None => Ok(touched),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::{
            process::{Command, Stdio},
            time::{Duration, Instant},
        };
        use windows_sys::Win32::System::Memory::*;

        const OLD: &[u8] = b"original";
        const NEW: &[u8] = b"new-save";
        const EXTERNAL: &[u8] = b"external";
        thread_local! { static HOOK: std::cell::RefCell<Option<(Stage, PathBuf)>> = const { std::cell::RefCell::new(None) }; }
        fn wait(path: &Path) {
            let start = Instant::now();
            while !path.exists() {
                assert!(
                    start.elapsed() < Duration::from_secs(8),
                    "process handshake timed out"
                );
                std::thread::sleep(Duration::from_millis(1));
            }
        }
        pub(super) fn process_point(stage: Stage) {
            if std::env::var("MDV_REPLACE_CRASH").ok().as_deref() == Some(&format!("{stage:?}")) {
                std::process::exit(79);
            }
            HOOK.with_borrow(|hook| {
                if let Some((at, dir)) = hook {
                    if *at == stage {
                        fs::write(dir.join("go"), b"go").unwrap();
                        wait(&dir.join("done"));
                    }
                }
            });
        }
        fn fixture() -> (tempfile::TempDir, PathBuf) {
            let dir = tempfile::tempdir().unwrap();
            let parent = dir.path().join("ancestor").join("parent");
            fs::create_dir_all(&parent).unwrap();
            let path = parent.join("résumé.md");
            fs::write(&path, OLD).unwrap();
            (dir, path)
        }
        fn assert_clean(path: &Path) {
            let leftovers: Vec<_> = fs::read_dir(path)
                .unwrap()
                .filter_map(Result::ok)
                .filter(|e| e.file_name().to_string_lossy().starts_with(".mdv-replace-"))
                .collect();
            assert!(leftovers.is_empty(), "scratch files remain: {leftovers:?}");
        }
        fn child(dir: &Path, scenario: &str) -> std::process::Child {
            Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "replace::win::tests::process_helper",
                    "--nocapture",
                ])
                .env("MDV_REPLACE_HELPER", scenario)
                .env("MDV_REPLACE_DIR", dir)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .spawn()
                .unwrap()
        }
        fn finish_trial(
            proc: &mut std::process::Child,
            dir: &Path,
            result: &Result<ReplaceOutcome, ReplaceError>,
        ) {
            if !dir.join("go").exists() {
                // A legitimate early Open/Verify refusal must not strand the
                // helper waiting for a later hook. Its mutation now follows the
                // refusal and must still be preserved by cleanup/recovery.
                assert!(result.is_err(), "successful save skipped its selected hook");
                eprintln!("RACE early refusal: {result:?}");
                fs::write(dir.join("go"), b"go").unwrap();
            }
            assert!(proc.wait().unwrap().success());
        }
        fn external(path: &Path, scenario: &str) -> io::Result<()> {
            match scenario {
                "write" => fs::write(path, EXTERNAL),
                "truncate" => OpenOptions::new().write(true).open(path)?.set_len(0),
                "equal-time" => {
                    let time = fs::metadata(path)?.modified()?;
                    let mut f = OpenOptions::new().write(true).open(path)?;
                    f.write_all(EXTERNAL)?;
                    f.set_times(fs::FileTimes::new().set_modified(time))
                }
                "replace" => {
                    let other = path.with_extension("external");
                    fs::write(&other, EXTERNAL)?;
                    fs::rename(other, path)
                }
                "recreate" => {
                    if path.exists() {
                        fs::remove_file(path)?;
                    }
                    fs::write(path, EXTERNAL)
                }
                "parent" | "ancestor" => {
                    let parent = if scenario == "parent" {
                        path.parent().unwrap()
                    } else {
                        path.parent().unwrap().parent().unwrap()
                    };
                    let moved = parent.with_extension("moved");
                    fs::rename(parent, &moved)?;
                    fs::create_dir(parent)?;
                    let relative = path.strip_prefix(parent).unwrap();
                    let replacement = parent.join(relative);
                    fs::create_dir_all(replacement.parent().unwrap())?;
                    fs::write(replacement, EXTERNAL)
                }
                "mapped" => {
                    let f = OpenOptions::new().read(true).write(true).open(path)?;
                    mapped_write(&f)
                }
                _ => unreachable!(),
            }
        }
        fn mapped_write(file: &File) -> io::Result<()> {
            // SAFETY: mapping is exactly the eight-byte fixture, handles and view
            // stay alive through the copy and are released on every success path.
            unsafe {
                let mapping = CreateFileMappingW(
                    file.as_raw_handle(),
                    std::ptr::null(),
                    PAGE_READWRITE,
                    0,
                    0,
                    std::ptr::null(),
                );
                if mapping.is_null() {
                    return Err(io::Error::last_os_error());
                }
                let view = MapViewOfFile(mapping, FILE_MAP_WRITE, 0, 0, 8);
                if view.Value.is_null() {
                    CloseHandle(mapping);
                    return Err(io::Error::last_os_error());
                }
                std::ptr::copy_nonoverlapping(EXTERNAL.as_ptr(), view.Value.cast::<u8>(), 8);
                let result = bool_result(FlushViewOfFile(view.Value, 8));
                UnmapViewOfFile(view);
                CloseHandle(mapping);
                result
            }
        }
        #[test]
        fn process_helper() {
            let Ok(scenario) = std::env::var("MDV_REPLACE_HELPER") else {
                return;
            };
            let dir = PathBuf::from(std::env::var_os("MDV_REPLACE_DIR").unwrap());
            let path = dir.join("ancestor/parent/résumé.md");
            if scenario == "crash-create" {
                fs::remove_file(&path).unwrap();
                let _ = create_new(&path, NEW);
                panic!("crash point was not reached");
            }
            if scenario == "crash" {
                let (snap, _) = snapshot_read(&path, 100).unwrap();
                let _ = replace_if_unchanged(&path, &snap, NEW);
                panic!("crash point was not reached");
            }
            if scenario.starts_with("hold-") {
                let share = match scenario.as_str() {
                    "hold-none" => 0,
                    "hold-read" => FILE_SHARE_READ,
                    _ => FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                };
                let writable = scenario != "hold-reader";
                let f = OpenOptions::new()
                    .read(true)
                    .write(writable)
                    .share_mode(share)
                    .open(&path)
                    .unwrap();
                fs::write(dir.join("ready"), b"ready").unwrap();
                wait(&dir.join("go"));
                if writable {
                    (&f).write_all(EXTERNAL).unwrap();
                }
                fs::write(dir.join("done"), b"ok").unwrap();
                wait(&dir.join("release"));
                return;
            }
            if scenario == "mapped-closed-handle" {
                let f = OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(&path)
                    .unwrap();
                // Deliberately close the file HANDLE while retaining a writable
                // section/view: sharing must also reject this case.
                unsafe {
                    let mapping = CreateFileMappingW(
                        f.as_raw_handle(),
                        std::ptr::null(),
                        PAGE_READWRITE,
                        0,
                        0,
                        std::ptr::null(),
                    );
                    assert!(!mapping.is_null());
                    let view = MapViewOfFile(mapping, FILE_MAP_WRITE, 0, 0, 8);
                    assert!(!view.Value.is_null());
                    drop(f);
                    fs::write(dir.join("ready"), b"ready").unwrap();
                    wait(&dir.join("go"));
                    std::ptr::copy_nonoverlapping(EXTERNAL.as_ptr(), view.Value.cast::<u8>(), 8);
                    assert_ne!(FlushViewOfFile(view.Value, 8), 0);
                    fs::write(dir.join("done"), b"ok").unwrap();
                    wait(&dir.join("release"));
                    UnmapViewOfFile(view);
                    CloseHandle(mapping);
                }
                return;
            }
            fs::write(dir.join("ready"), b"ready").unwrap();
            wait(&dir.join("go"));
            let result = external(&path, &scenario);
            fs::write(dir.join("done"), if result.is_ok() { b"ok" } else { b"no" }).unwrap();
        }
        #[test]
        fn successful_controls_bounds_and_conflicts() {
            let (dir, path) = fixture();
            let (snap, raw) = snapshot_read(&path, 8).unwrap();
            assert_eq!(raw, OLD);
            assert_eq!(
                snapshot_read(&path, 7).unwrap_err().kind(),
                io::ErrorKind::FileTooLarge
            );
            let ReplaceOutcome::Replaced(new) = replace_if_unchanged(&path, &snap, NEW).unwrap();
            assert_eq!(fs::read(&path).unwrap(), NEW);
            assert_ne!(snap.file_id, new.file_id);
            assert_eq!(snapshot_read(&path, 8).unwrap().0, new);
            assert!(matches!(
                replace_if_unchanged(&path, &snap, NEW),
                Err(ReplaceError::Conflict(ConflictKind::Replaced))
            ));
            fs::write(&path, EXTERNAL).unwrap();
            assert!(matches!(
                replace_if_unchanged(&path, &new, NEW),
                Err(ReplaceError::Conflict(ConflictKind::Changed))
            ));
            assert!(create_new(&path, NEW).is_err());
            assert_eq!(fs::read(&path).unwrap(), EXTERNAL);
            let fresh = dir.path().join("fresh.md");
            create_new(&fresh, NEW).unwrap();
            assert_eq!(fs::read(&fresh).unwrap(), NEW);
            assert_clean(path.parent().unwrap());
            assert_clean(dir.path());
        }
        #[test]
        fn separate_process_races() {
            // Four forced interleavings x four trials. This exercises exact race
            // windows deterministically rather than depending on scheduler luck.
            for scenario in [
                "write",
                "truncate",
                "replace",
                "recreate",
                "equal-time",
                "mapped",
                "parent",
                "ancestor",
            ] {
                let (mut saved, mut refused) = (0, 0);
                for stage in [
                    Stage::Open,
                    Stage::Verify,
                    Stage::RenameIntoPlace,
                    Stage::Cleanup,
                ] {
                    for _ in 0..4 {
                        let (dir, path) = fixture();
                        let (snap, _) = snapshot_read(&path, 100).unwrap();
                        let mut proc = child(dir.path(), scenario);
                        wait(&dir.path().join("ready"));
                        HOOK.with_borrow_mut(|h| *h = Some((stage, dir.path().to_owned())));
                        let result = replace_if_unchanged(&path, &snap, NEW);
                        HOOK.with_borrow_mut(|h| *h = None);
                        finish_trial(&mut proc, dir.path(), &result);
                        let changed = fs::read(dir.path().join("done")).unwrap() == b"ok";
                        let actual = fs::read(&path).unwrap();
                        if result.is_ok() {
                            saved += 1;
                            assert!(
                                !changed,
                                "external mutation succeeded before commit: {scenario} {stage:?}"
                            );
                            assert_eq!(actual, NEW);
                        } else {
                            refused += 1;
                            assert!(
                                matches!(
                                    result,
                                    Err(ReplaceError::Conflict(_) | ReplaceError::Io(_, _))
                                ),
                                "{result:?}"
                            );
                            if changed {
                                assert_eq!(
                                    actual,
                                    if scenario == "truncate" {
                                        b""
                                    } else {
                                        EXTERNAL
                                    }
                                );
                            } else {
                                assert_eq!(actual, OLD);
                            }
                        }
                        // A scanner may briefly hold a fresh artifact; recovery then
                        // refuses as Locked (safe) and a later save retries it.
                        let mut recovered = recover_journal(path.parent().unwrap());
                        for _ in 0..50 {
                            match &recovered {
                                Err(e) if e.kind() == io::ErrorKind::WouldBlock => {
                                    std::thread::sleep(Duration::from_millis(10));
                                    recovered = recover_journal(path.parent().unwrap());
                                }
                                _ => break,
                            }
                        }
                        if let Err(e) = recovered {
                            let names: Vec<_> = fs::read_dir(path.parent().unwrap())
                                .unwrap()
                                .filter_map(Result::ok)
                                .map(|e| e.file_name())
                                .collect();
                            panic!("{scenario} {stage:?}: recovery failed: {e:?}; files {names:?}; result {result:?}");
                        }
                        assert_clean(path.parent().unwrap());
                    }
                }
                eprintln!("RACE {scenario}: iterations=16 saved={saved} refused={refused}");
            }
        }
        #[test]
        fn already_open_handles_and_writable_sections() {
            for scenario in [
                "hold-none",
                "hold-read",
                "hold-all",
                "hold-reader",
                "mapped-closed-handle",
            ] {
                let (mut saved, mut refused) = (0, 0);
                for _ in 0..8 {
                    let (dir, path) = fixture();
                    let (snap, _) = snapshot_read(&path, 100).unwrap();
                    let mut proc = child(dir.path(), scenario);
                    wait(&dir.path().join("ready"));
                    fs::write(dir.path().join("go"), b"go").unwrap();
                    wait(&dir.path().join("done"));
                    let result = replace_if_unchanged(&path, &snap, NEW);
                    fs::write(dir.path().join("release"), b"release").unwrap();
                    assert!(proc.wait().unwrap().success());
                    if scenario == "hold-reader" {
                        result.unwrap();
                        saved += 1;
                        assert_eq!(fs::read(&path).unwrap(), NEW);
                    } else {
                        assert!(
                            matches!(result, Err(ReplaceError::Conflict(ConflictKind::Locked))),
                            "{scenario}: {result:?}"
                        );
                        refused += 1;
                        assert_eq!(fs::read(&path).unwrap(), EXTERNAL);
                    }
                    assert_clean(path.parent().unwrap());
                }
                eprintln!("RACE {scenario}: iterations=8 saved={saved} refused={refused}");
            }
        }
        #[test]
        fn injected_errors_and_process_exit_recover() {
            for stage in [
                Stage::Open,
                Stage::Verify,
                Stage::WriteTemp,
                Stage::Flush,
                Stage::RenameAside,
                Stage::RenameIntoPlace,
                Stage::Cleanup,
            ] {
                let (_dir, path) = fixture();
                let (snap, _) = snapshot_read(&path, 100).unwrap();
                FAULT.with(|f| f.set(Some(stage)));
                // Past the commit point (Cleanup) the save is reported as done.
                assert_eq!(
                    replace_if_unchanged(&path, &snap, NEW).is_ok(),
                    stage == Stage::Cleanup
                );
                FAULT.with(|f| f.set(None));
                recover_journal(path.parent().unwrap()).unwrap();
                assert!(recover_journal(path.parent().unwrap()).unwrap().is_empty());
                assert_eq!(
                    fs::read(&path).unwrap(),
                    if stage == Stage::Cleanup { NEW } else { OLD }
                );
                assert_clean(path.parent().unwrap());

                let (dir, path) = fixture();
                let status = Command::new(std::env::current_exe().unwrap())
                    .args([
                        "--exact",
                        "replace::win::tests::process_helper",
                        "--nocapture",
                    ])
                    .env("MDV_REPLACE_HELPER", "crash")
                    .env("MDV_REPLACE_DIR", dir.path())
                    .env("MDV_REPLACE_CRASH", format!("{stage:?}"))
                    .stdout(Stdio::null())
                    .status()
                    .unwrap();
                assert_eq!(status.code(), Some(79));
                if stage == Stage::RenameIntoPlace {
                    assert!(!path.exists());
                    assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 3);
                } else {
                    assert_eq!(
                        fs::read(&path).unwrap(),
                        if stage == Stage::Cleanup { NEW } else { OLD }
                    );
                }
                recover_journal(path.parent().unwrap()).unwrap();
                assert!(recover_journal(path.parent().unwrap()).unwrap().is_empty());
                assert_eq!(
                    fs::read(&path).unwrap(),
                    if stage == Stage::Cleanup { NEW } else { OLD }
                );
                assert_clean(path.parent().unwrap());
                eprintln!("FAULT {stage:?}: injected=1 crash=1 recovered=2");
            }
        }
        #[test]
        fn read_only_originals_are_refused_and_left_untouched() {
            let (_dir, path) = fixture();
            let (snap, _) = snapshot_read(&path, 100).unwrap();
            let mut permissions = fs::metadata(&path).unwrap().permissions();
            permissions.set_readonly(true);
            fs::set_permissions(&path, permissions.clone()).unwrap();
            assert!(matches!(
                replace_if_unchanged(&path, &snap, NEW),
                Err(ReplaceError::Conflict(ConflictKind::Locked))
            ));
            assert_eq!(fs::read(&path).unwrap(), OLD);
            assert!(fs::metadata(&path).unwrap().permissions().readonly());
            assert_clean(path.parent().unwrap());
            #[allow(clippy::permissions_set_readonly_false)]
            permissions.set_readonly(false);
            fs::set_permissions(&path, permissions).unwrap();
        }

        #[test]
        fn recovery_after_a_completed_save_never_resurrects_the_old_bytes() {
            // Crash after the rename into place, then the user moves the new file away.
            let (_dir, path) = crash_fixture(Stage::Cleanup);
            let moved = path.with_file_name("moved.md");
            fs::rename(&path, &moved).unwrap();
            recover_journal(path.parent().unwrap()).unwrap();
            assert!(
                !path.exists(),
                "the old version must not reappear under the real name"
            );
            assert_eq!(fs::read(&moved).unwrap(), NEW);
            let kept: Vec<_> = fs::read_dir(path.parent().unwrap())
                .unwrap()
                .filter_map(Result::ok)
                .filter(|e| {
                    e.file_name()
                        .to_string_lossy()
                        .contains("(MDviewer recovered ")
                })
                .map(|e| fs::read(e.path()).unwrap())
                .collect();
            assert_eq!(kept, vec![OLD.to_vec()]);
            assert_clean(path.parent().unwrap());
        }

        #[test]
        fn one_stuck_journal_does_not_block_recovery_of_another() {
            let (dir, path) = crash_fixture(Stage::RenameIntoPlace);
            fs::write(
                path.with_file_name(".mdv-replace-0-0-0.journal"),
                b"not a journal",
            )
            .unwrap();
            assert!(recover_journal(path.parent().unwrap()).is_err());
            // The real interrupted save was still rolled back.
            assert_eq!(fs::read(&path).unwrap(), OLD);
            drop(dir);
        }

        #[test]
        fn unsupported_scope_and_private_errors() {
            let (_dir, path) = fixture();
            let (snap, _) = snapshot_read(&path, 100).unwrap();
            for path in [
                r"\\server\share\x.md",
                r"\\.\NUL",
                r"\\?\C:\x.md",
                r"C:\NUL.md",
                r"C:\x.md:ads",
                r"C:\x. ",
            ] {
                assert!(matches!(
                    replace_if_unchanged(Path::new(path), &snap, NEW),
                    Err(ReplaceError::Unsupported(_))
                ));
            }
            let link = path.with_extension("link");
            fs::hard_link(&path, &link).unwrap();
            assert!(matches!(
                replace_if_unchanged(&path, &snap, NEW),
                Err(ReplaceError::Unsupported(_))
            ));
            assert_eq!(fs::read(&path).unwrap(), OLD);
            assert_eq!(
                ReplaceError::Unsupported("private/path/document").to_string(),
                "Unsupported file or filesystem"
            );
        }

        #[test]
        fn create_new_process_race() {
            let (mut saved, mut refused) = (0, 0);
            for stage in [
                Stage::Open,
                Stage::Verify,
                Stage::RenameIntoPlace,
                Stage::Cleanup,
            ] {
                for _ in 0..4 {
                    let (dir, path) = fixture();
                    fs::remove_file(&path).unwrap();
                    let mut proc = child(dir.path(), "write");
                    wait(&dir.path().join("ready"));
                    HOOK.with_borrow_mut(|h| *h = Some((stage, dir.path().to_owned())));
                    let result = create_new(&path, NEW);
                    HOOK.with_borrow_mut(|h| *h = None);
                    finish_trial(&mut proc, dir.path(), &result);
                    let changed = fs::read(dir.path().join("done")).unwrap() == b"ok";
                    if result.is_ok() {
                        saved += 1;
                        assert!(!changed);
                        assert_eq!(fs::read(&path).unwrap(), NEW);
                    } else {
                        refused += 1;
                        assert!(changed);
                        assert!(matches!(
                            result,
                            Err(ReplaceError::Conflict(_) | ReplaceError::Io(_, _))
                        ));
                        assert_eq!(fs::read(&path).unwrap(), EXTERNAL);
                    }
                    recover_journal(path.parent().unwrap()).unwrap();
                    assert_clean(path.parent().unwrap());
                }
            }
            eprintln!("RACE create-new: iterations=16 saved={saved} refused={refused}");

            // Regression for refusal before the selected hook: the helper must
            // still finish, and its later bytes must survive our error cleanup.
            let (dir, path) = fixture();
            fs::remove_file(&path).unwrap();
            let mut proc = child(dir.path(), "write");
            wait(&dir.path().join("ready"));
            HOOK.with_borrow_mut(|h| *h = Some((Stage::Verify, dir.path().to_owned())));
            FAULT.with(|f| f.set(Some(Stage::Open)));
            let result = create_new(&path, NEW);
            FAULT.with(|f| f.set(None));
            HOOK.with_borrow_mut(|h| *h = None);
            finish_trial(&mut proc, dir.path(), &result);
            assert_eq!(fs::read(&path).unwrap(), EXTERNAL);
            assert_clean(path.parent().unwrap());
        }

        #[test]
        fn create_new_faults_leave_no_partial_destination() {
            for stage in [
                Stage::Open,
                Stage::Verify,
                Stage::WriteTemp,
                Stage::Flush,
                Stage::RenameAside,
                Stage::RenameIntoPlace,
                Stage::Cleanup,
            ] {
                let (_dir, path) = fixture();
                fs::remove_file(&path).unwrap();
                FAULT.with(|f| f.set(Some(stage)));
                // Past the commit point (Cleanup) the creation is reported as done.
                assert_eq!(create_new(&path, NEW).is_ok(), stage == Stage::Cleanup);
                FAULT.with(|f| f.set(None));
                recover_journal(path.parent().unwrap()).unwrap();
                if path.exists() {
                    assert_eq!(fs::read(&path).unwrap(), NEW);
                }
                assert_eq!(path.exists(), stage == Stage::Cleanup);
                assert_clean(path.parent().unwrap());

                let (dir, path) = fixture();
                let status = Command::new(std::env::current_exe().unwrap())
                    .args([
                        "--exact",
                        "replace::win::tests::process_helper",
                        "--nocapture",
                    ])
                    .env("MDV_REPLACE_HELPER", "crash-create")
                    .env("MDV_REPLACE_DIR", dir.path())
                    .env("MDV_REPLACE_CRASH", format!("{stage:?}"))
                    .stdout(Stdio::null())
                    .status()
                    .unwrap();
                assert_eq!(status.code(), Some(79));
                recover_journal(path.parent().unwrap()).unwrap();
                assert!(recover_journal(path.parent().unwrap()).unwrap().is_empty());
                if path.exists() {
                    assert_eq!(fs::read(&path).unwrap(), NEW);
                }
                assert_eq!(path.exists(), stage == Stage::Cleanup);
                assert_clean(path.parent().unwrap());
                eprintln!("FAULT create-new {stage:?}: injected=1 crash=1 recovered=2");
            }
        }

        fn crash_fixture(stage: Stage) -> (tempfile::TempDir, PathBuf) {
            let (dir, path) = fixture();
            let status = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "replace::win::tests::process_helper",
                    "--nocapture",
                ])
                .env("MDV_REPLACE_HELPER", "crash")
                .env("MDV_REPLACE_DIR", dir.path())
                .env("MDV_REPLACE_CRASH", format!("{stage:?}"))
                .stdout(Stdio::null())
                .status()
                .unwrap();
            assert_eq!(status.code(), Some(79));
            (dir, path)
        }
        fn artifact(path: &Path, extension: &str) -> PathBuf {
            fs::read_dir(path.parent().unwrap())
                .unwrap()
                .filter_map(Result::ok)
                .map(|e| e.path())
                .find(|p| p.extension().is_some_and(|e| e == extension))
                .unwrap()
        }
        #[test]
        fn recovery_preserves_external_claimants_and_modified_artifacts() {
            for stage in [Stage::RenameIntoPlace, Stage::Cleanup] {
                let (_dir, path) = crash_fixture(stage);
                fs::write(&path, EXTERNAL).unwrap();
                recover_journal(path.parent().unwrap()).unwrap();
                assert_eq!(fs::read(&path).unwrap(), EXTERNAL);
                assert!(recover_journal(path.parent().unwrap()).unwrap().is_empty());
                assert_clean(path.parent().unwrap());
                let recovered: Vec<_> = fs::read_dir(path.parent().unwrap())
                    .unwrap()
                    .filter_map(Result::ok)
                    .filter(|e| {
                        e.file_name()
                            .to_string_lossy()
                            .contains("(MDviewer recovered ")
                    })
                    .map(|e| fs::read(e.path()).unwrap())
                    .collect();
                if stage == Stage::RenameIntoPlace {
                    // An outside file took the name in the gap: the original survives beside it.
                    assert_eq!(recovered, vec![OLD.to_vec()]);
                } else {
                    // Our committed file was edited after the crash: the commit stands.
                    assert!(recovered.is_empty());
                }
            }
            for extension in ["old", "tmp"] {
                let (_dir, path) = crash_fixture(Stage::RenameIntoPlace);
                let modified = artifact(&path, extension);
                fs::write(&modified, EXTERNAL).unwrap();
                for _ in 0..2 {
                    assert!(recover_journal(path.parent().unwrap()).is_err());
                    assert_eq!(fs::read(&modified).unwrap(), EXTERNAL);
                    assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 3);
                }
            }
            let (_dir, path) = crash_fixture(Stage::RenameIntoPlace);
            let journal = artifact(&path, "journal");
            fs::write(&journal, b"invalid journal").unwrap();
            assert_eq!(
                recover_journal(path.parent().unwrap()).unwrap_err().kind(),
                io::ErrorKind::InvalidData
            );
            assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 3);
            eprintln!("RECOVERY external-claimants=2 preserved; modified-artifacts=2 refused; malformed=1 refused");
        }

        #[test]
        fn junctions_and_symlinks_are_not_followed() {
            let (dir, path) = fixture();
            let (snap, _) = snapshot_read(&path, 100).unwrap();
            let junction = dir.path().join("junction");
            let output = Command::new("cmd.exe")
                .args(["/d", "/c", "mklink", "/J"])
                .arg(&junction)
                .arg(path.parent().unwrap())
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "junction fixture failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            for candidate in [&junction, &junction.join("résumé.md")] {
                assert!(matches!(
                    replace_if_unchanged(candidate, &snap, NEW),
                    Err(ReplaceError::Unsupported(_))
                ));
            }
            assert!(matches!(
                create_new(&junction.join("new.md"), NEW),
                Err(ReplaceError::Unsupported(_))
            ));
            assert!(snapshot_read(&junction.join("résumé.md"), 100).is_err());
            assert!(recover_journal(&junction).is_err());
            fs::remove_dir(&junction).unwrap(); // unlink, never recurse through it
            let symlink = dir.path().join("symlink.md");
            match std::os::windows::fs::symlink_file(&path, &symlink) {
                Ok(()) => {
                    assert!(matches!(replace_if_unchanged(&symlink, &snap, NEW), Err(ReplaceError::Unsupported(_))));
                    fs::remove_file(symlink).unwrap();
                    eprintln!("SCOPE junction parent/file + file symlink: refused");
                },
                Err(e) if e.raw_os_error() == Some(ERROR_PRIVILEGE_NOT_HELD as i32) =>
                    eprintln!("SCOPE junction parent/file: refused; file symlink NOT VERIFIED (creation privilege unavailable)"),
                Err(e) => panic!("symlink fixture failed: {e}"),
            }
            assert_eq!(fs::read(&path).unwrap(), OLD);
            for code in [
                ERROR_ACCESS_DENIED,
                ERROR_SHARING_VIOLATION,
                ERROR_LOCK_VIOLATION,
            ] {
                assert!(matches!(
                    err(io::Error::from_raw_os_error(code as i32), Stage::Open),
                    ReplaceError::Conflict(ConflictKind::Locked)
                ));
            }
            let mut name = [0u16; 32];
            let f = File::open(&path).unwrap();
            assert_ne!(
                unsafe {
                    GetVolumeInformationByHandleW(
                        f.as_raw_handle(),
                        std::ptr::null_mut(),
                        0,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        name.as_mut_ptr(),
                        32,
                    )
                },
                0
            );
            let end = name.iter().position(|&n| n == 0).unwrap();
            eprintln!("FILESYSTEM {}", String::from_utf16_lossy(&name[..end]));
        }
    }
}

#[cfg(test)]
mod hash_tests {
    use super::*;
    #[test]
    fn sha256_known_answers() {
        for (bytes, expected) in [
            (
                b"".as_slice(),
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            ),
            (
                b"abc".as_slice(),
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            ),
            (
                b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq".as_slice(),
                "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
            ),
            (
                vec![b'a'; 1_000_000].as_slice(),
                "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
            ),
        ] {
            assert_eq!(
                digest(bytes)
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect::<String>(),
                expected
            );
        }
    }
}
