#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod export_policy;
mod file_policy;
mod linepatch;
mod registry;
mod replace;
mod watch;

use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

use tauri::webview::NewWindowResponse;
use tauri::{Emitter, Manager, WebviewWindowBuilder};

use commands::external::is_app_navigation;
use file_policy::{resolve_launch_paths, PendingFiles};
use registry::Registry;

const FILES_PENDING_EVENT: &str = "mdviewer:files-pending";
const FILES_CHANGED_EVENT: &str = "mdviewer:files-changed";

#[derive(Default)]
struct DesktopState {
    pending: Mutex<PendingFiles>,
    picker_open: AtomicBool,
    // Shared with blocking save tasks; never locked across a dialog or write.
    registry: std::sync::Arc<Mutex<Registry>>,
    /// Created in setup (it needs the app handle to emit); starts watching lazily.
    watch: std::sync::OnceLock<watch::FileWatch>,
}

impl DesktopState {
    /// Follow a newly bound file; a no-op before setup (tests) or if watching fails.
    fn follow(&self, token: &registry::Token, path: &Path) {
        if let Some(watch) = self.watch.get() {
            watch.add(token, path);
        }
    }

    fn unfollow(&self, token: &registry::Token) {
        if let Some(watch) = self.watch.get() {
            watch.remove(token);
        }
    }
}

fn main() {
    let state = DesktopState::default();
    let cwd = std::env::current_dir().unwrap_or_default();
    state
        .pending
        .lock()
        .expect("new file queue is available")
        .enqueue(resolve_launch_paths(std::env::args_os().skip(1), &cwd));

    tauri::Builder::default()
        .manage(state)
        // Register first: it forwards new launches before other plugins run.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths =
                resolve_launch_paths(args.into_iter().skip(1).map(Into::into), Path::new(&cwd));
            let state = app.state::<DesktopState>();
            let mut queue = state
                .pending
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            queue.enqueue(paths);
            drop(queue);
            // A lost early event is harmless: the reader always drains once after
            // registering its listener. Contents stay queued until that command.
            let _ = app.emit(FILES_PENDING_EVENT, ());
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        // The frontend's explicit open_external command owns link handling; do not
        // inject the opener plugin's broader mailto/tel/target=_blank interceptor.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::open::open_files,
            commands::open::take_pending_files,
            commands::external::open_external,
            commands::export::save_export,
            commands::patch::patch_document,
            commands::save::save_document,
            commands::save::save_document_as,
            commands::save::release_document,
            commands::reload::read_document
        ])
        .setup(|app| {
            let emitter = app.handle().clone();
            // The event carries capability tokens only: never paths or contents.
            let _ = app
                .state::<DesktopState>()
                .watch
                .set(watch::FileWatch::new(move |tokens| {
                    let _ = emitter.emit(FILES_CHANGED_EVENT, tokens);
                }));
            let config = app
                .config()
                .app
                .windows
                .first()
                .ok_or("missing main window configuration")?;
            WebviewWindowBuilder::from_config(app, config)?
                .on_navigation(is_app_navigation)
                .on_new_window(|_, _| NewWindowResponse::Deny)
                // Explicit exports use the async save_export command. Never open
                // modal UI from WebView2's synchronous download callback.
                .on_download(|_, _| false)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run MDviewer Desktop");
}
