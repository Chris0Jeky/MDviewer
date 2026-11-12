/**
 * The Edit surface's lazy chunk (S5): the workspace's own source editor (Find, Format, the
 * highlighted backdrop and the paste gates) beside the live reader. No App, preview or Paged.js.
 */
import "../styles/editor.css";
export { mountEditor, type EditorController } from "../ui/Editor";
