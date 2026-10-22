fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "open_files",
            "take_pending_files",
            "open_external",
            "save_export",
        ]),
    ))
    .expect("failed to prepare the desktop application");
}
