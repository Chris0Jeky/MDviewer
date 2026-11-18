/**
 * The PDF workbench's one entry point. The shell reaches it only through
 * `import("../pdf")` when a PDF is opened, so neither this chunk nor the PDFium
 * wasm loads before then (PDF_WORKBENCH.md, "Code layout and seams").
 */
import "./pdf.css";

export { mountPdf, type PdfView, type PdfViewOptions } from "./view";
export { unloadEngine } from "./engine";
