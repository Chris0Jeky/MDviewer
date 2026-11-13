# Third-party notices

The root GPL licence covers owner-authored MDviewer code and documentation. npm
dependencies retain the licences recorded in `package-lock.json`; these include
MIT, MIT-0, ISC, Apache-2.0, CC0-1.0, Zlib and MPL-2.0 components. They are not
relicensed by this project.

`npm run build` writes this notice, the complete GPL text, an exact source link,
and the installed dependency licence texts into `dist/`. Preserve those files
when redistributing or deploying the built application and satisfy the
corresponding dependency terms.

The PDF engine `@embedpdf/pdfium` is PDFium (BSD-3-Clause, Apache-2.0) compiled to WebAssembly
under an MIT wrapper. The libraries compiled into its `pdfium.wasm` and their licence texts are
listed in `docs/licenses/PDFIUM_THIRD_PARTY_NOTICES.txt`, which the build appends to
`THIRD_PARTY_LICENSES.txt`.
