fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "open_files",
            "take_pending_files",
            "open_external",
            "save_export",
            "save_document",
            "save_document_as",
            "release_document",
            "read_document",
            "library_list",
            "library_scan",
            "library_open",
            "library_pin",
            "library_unpin",
            "library_forget",
            "library_mark_seen",
            "library_add_project",
            "library_clear",
            "open_relative",
            "read_asset",
        ]),
    ))
    .expect("failed to prepare the desktop application");
}
