# Native license fallback sources

The native notice generator includes license and notice files from the Cargo crates
selected for the Windows build. A few published crates omit their license files.
This directory supplies those texts without adding network requests to a build.

`provenance.json` records the exact package version, upstream source revision, URL,
and SHA-256 of every fallback. The generator checks each crate's recorded VCS
revision and each file checksum; dependency upgrades must refresh the affected
records deliberately.

For `selectors`, neither its crate nor that source revision includes the MPL text.
Its `lib.rs` header declares Mozilla Public License 2.0 and points to Mozilla.
`MPL-2.0.txt` is the license steward's text for that declared version; the record
links to the exact source declaration.

`webview2-com-sys` includes Microsoft's WebView2 loader binaries in addition to
the MIT-licensed Rust wrappers. The LICENSE and NOTICE from Microsoft.Web.WebView2
SDK 1.0.3800.47 are included. Its x64 static loader was compared byte for byte to
the crate's loader; the checked-in record also verifies the crate loader hash.
The separately installed Evergreen WebView2 Runtime is supplied by Microsoft.

The generator emits `dist-desktop/NATIVE_THIRD_PARTY_NOTICES.txt`. It fails if a
resolved dependency has no license text or if any fallback verification fails.
It also copies the exact pinned Rust toolchain's `COPYRIGHT-library.html` into
the output directory as `RUST_STDLIB_NOTICES.html`, records its hash in the text
notice, and fails if that shipped standard-library notice is unavailable.
