//! Relative links, imports and images (companion push S6, native half).

use tauri::ipc::Response;
use tauri::{AppHandle, State};

use crate::assets;
use crate::commands::open::OpenBatch;
use crate::file_policy::read_batch;
use crate::registry::{capture_revision, Token};
use crate::DesktopState;

fn base(state: &DesktopState, token: &str) -> Result<std::path::PathBuf, String> {
    let token = Token::parse(token).ok_or("This document is no longer linked to its file.")?;
    state
        .registry
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(&token)
        .map(|binding| binding.path.clone())
        .ok_or_else(|| "This document is no longer linked to its file.".into())
}

/// Open a Markdown file a document links to (`other.md`, `../x.md#part`,
/// `@CLAUDE.md`, or a wiki-style `name`), resolved against that document's folder
/// and admitted through the ordinary open policy.
#[tauri::command]
pub(crate) async fn open_relative(
    app: AppHandle,
    state: State<'_, DesktopState>,
    token: String,
    href: String,
) -> Result<OpenBatch, String> {
    let document = base(&state, &token)?;
    let target = assets::resolve(&document, &href)
        .map(assets::with_markdown_extension)
        .ok_or("This link does not point to a local Markdown file next to this document.")?;
    if !assets::without_new_links(&document, &target) {
        return Err(
            "This link goes through a folder shortcut (symlink or junction) and is not followed."
                .into(),
        );
    }
    let batch =
        tauri::async_runtime::spawn_blocking(move || read_batch([target], capture_revision))
            .await
            .map_err(|_| "The linked file could not be read.".to_string())?;
    Ok(OpenBatch::from_read_batch(
        batch,
        &mut state
            .registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()),
    )
    .follow(&state)
    .remember(&app))
}

/// The bytes of a local image a document references, for a blob URL. Errors are
/// stable codes; nothing about the path is returned.
#[tauri::command]
pub(crate) async fn read_asset(
    state: State<'_, DesktopState>,
    token: String,
    src: String,
) -> Result<Response, String> {
    let document = base(&state, &token)?;
    let target = assets::resolve(&document, &src).ok_or("not-local")?;
    tauri::async_runtime::spawn_blocking(move || {
        if !assets::without_new_links(&document, &target) {
            return Err("not-local");
        }
        assets::read_image(&target)
    })
    .await
    .map_err(|_| "unreadable".to_string())?
    .map(|(bytes, _)| Response::new(bytes))
    .map_err(str::to_owned)
}
