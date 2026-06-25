/**
 * PRIMARY export path — native print.
 *
 * The paginated `.pagedjs_page` DOM is already laid out exactly as it must appear on
 * paper. `@media print` (in app.css/preview.css) hides the app chrome and forces the
 * Shiki light side, so `window.print()` produces a vector, selectable-text PDF with the
 * page breaks Paged.js computed — no re-layout, no rasterization.
 *
 * The host parameter is accepted for symmetry with the fallback path and to let callers
 * assert a paginated host exists before invoking; printing itself is global to the page.
 */

export async function exportViaPrint(_host: HTMLElement): Promise<void> {
  // window.print() is synchronous in spec but blocks until the dialog resolves in
  // practice; wrap so callers can await a settled promise and re-enable UI afterward.
  window.print();
  return Promise.resolve();
}
