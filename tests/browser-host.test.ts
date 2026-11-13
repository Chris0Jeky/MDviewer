import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Host } from "../src/desktop/native";

/**
 * The browser host (web parity W1) against in-memory file handles shaped like the File System
 * Access API. The Playwright suite `tests/webhost-e2e/` repeats the save path on real Chromium
 * handles; this file pins the decisions: what is compared before a write, what is refused, and
 * that bytes round-trip exactly.
 */
class FakeHandle {
  readonly kind = "file";
  modified = 1_000;
  exists = true;
  writes = 0;
  constructor(public name: string, public bytes: Uint8Array) {}
  async getFile(): Promise<File> {
    if (!this.exists) throw new DOMException("gone", "NotFoundError");
    return new File([this.bytes as Uint8Array<ArrayBuffer>], this.name, { lastModified: this.modified });
  }
  async createWritable() {
    const chunks: Uint8Array[] = [];
    return {
      write: async (data: Uint8Array) => { chunks.push(data); },
      close: async () => {
        this.bytes = new Uint8Array(chunks.flatMap(chunk => Array.from(chunk)));
        this.exists = true;
        this.modified += 1;
        this.writes += 1;
      },
      abort: async () => undefined,
    };
  }
  async isSameEntry(other: unknown): Promise<boolean> { return other === this; }
  async queryPermission(): Promise<string> { return "granted"; }
  /** Another program writes the file. */
  outside(bytes: Uint8Array, keepTime = false): void { this.bytes = bytes; if (!keepTime) this.modified += 10; }
}

const utf16le = (text: string): Uint8Array => {
  const out = new Uint8Array(2 + text.length * 2);
  out.set([0xff, 0xfe]);
  for (let index = 0; index < text.length; index++) new DataView(out.buffer).setUint16(2 + index * 2, text.charCodeAt(index), true);
  return out;
};
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

let host: Host;
let pick: FakeHandle[];
let saveTo: FakeHandle | null;

beforeEach(async () => {
  pick = [];
  saveTo = null;
  Object.assign(window, {
    showOpenFilePicker: vi.fn(async () => {
      if (!pick.length) throw new DOMException("canceled", "AbortError");
      return pick;
    }),
    showSaveFilePicker: vi.fn(async () => {
      if (!saveTo) throw new DOMException("canceled", "AbortError");
      return saveTo;
    }),
  });
  vi.resetModules();
  host = (await import("../src/desktop/hosts/browser")).browserHost;
});

async function open(handle: FakeHandle) {
  pick = [handle];
  const batch = await host.open();
  expect(batch.errors).toEqual([]);
  return batch.documents[0]!;
}

describe("browser host: open and save", () => {
  it("is available only with the picker API", async () => {
    expect(host.available).toBe(true);
    Object.assign(window, { showOpenFilePicker: undefined, showSaveFilePicker: undefined });
    vi.resetModules();
    const without = (await import("../src/desktop/hosts/browser")).browserHost;
    expect(without.available).toBe(false);
    expect(without.openDropped!([{ kind: "file", getAsFile: () => null, getAsFileSystemHandle: async () => null }] as unknown as DataTransferItemList)).toBeNull();
  });

  it("opens a picked file bound by token, with its encoding and line endings", async () => {
    const doc = await open(new FakeHandle("notes.md", utf16le("# Notes\r\n\r\nText.\r\n")));
    expect(doc).toMatchObject({ name: "notes.md", text: "# Notes\r\n\r\nText.\r\n", encoding: "utf-16le", eol: "crlf", path: "notes.md" });
    expect(doc.token).toMatch(/^[0-9a-f]{32}$/);
  });

  it("a canceled picker opens nothing", async () => {
    expect(await host.open()).toEqual({ documents: [], errors: [], canceled: true });
  });

  it("refuses unsupported types and over-limit files per file, opening the rest", async () => {
    pick = [new FakeHandle("a.html", utf8("<p>")), new FakeHandle("b.md", utf8("# B\n")), new FakeHandle("c.md", new Uint8Array([0xc3, 0x28]))];
    const batch = await host.open();
    expect(batch.documents.map(doc => doc.name)).toEqual(["b.md"]);
    expect(batch.errors.map(error => error.name)).toEqual(["a.html", "c.md"]);
  });

  it("Save writes the editor's LF text back in the file's encoding and endings, byte for byte", async () => {
    const handle = new FakeHandle("notes.md", utf16le("# Notes\r\n\r\nText.\r\n"));
    const doc = await open(handle);
    const result = await host.saveDocument(doc.token!, 0, "# Notes\n\nText, edited.\n", false);
    expect(result).toMatchObject({ outcome: "saved", token: doc.token, generation: 1, encoding: "utf-16le", eol: "crlf" });
    expect(handle.bytes).toEqual(utf16le("# Notes\r\n\r\nText, edited.\r\n"));
    // The new bytes are the baseline: a second save does not see its own write as an outside change.
    expect(await host.saveDocument(doc.token!, 1, "# Notes\n", false)).toMatchObject({ outcome: "saved", generation: 2 });
  });

  it("refuses to write over an outside change, even one with the same size and time", async () => {
    const handle = new FakeHandle("notes.md", utf8("# Notes\n"));
    const doc = await open(handle);
    handle.outside(utf8("# Other\n"), true); // same length, same last-modified time
    expect(await host.saveDocument(doc.token!, 0, "# Mine\n", false)).toEqual({ outcome: "conflict", reason: "changed" });
    expect(new TextDecoder().decode(handle.bytes)).toBe("# Other\n");
    expect(handle.writes).toBe(0);
  });

  it("refuses a moved or deleted file and does not recreate it", async () => {
    const handle = new FakeHandle("notes.md", utf8("# Notes\n"));
    const doc = await open(handle);
    handle.exists = false;
    expect(await host.saveDocument(doc.token!, 0, "# Mine\n", false)).toEqual({ outcome: "conflict", reason: "missing" });
    expect(handle.writes).toBe(0);
  });

  it("fences stale generations, unknown tokens, mixed endings and concurrent saves", async () => {
    const handle = new FakeHandle("mixed.md", utf8("a\r\nb\n"));
    const doc = await open(handle);
    expect(await host.saveDocument(doc.token!, 5, "a\n", false)).toEqual({ outcome: "failed", code: "stale" });
    expect(await host.saveDocument("0".repeat(32), 0, "a\n", false)).toEqual({ outcome: "failed", code: "revoked" });
    expect(await host.saveDocument(doc.token!, 0, "a\nb\n", false)).toEqual({ outcome: "mixed-line-endings" });
    const [first, second] = await Promise.all([host.saveDocument(doc.token!, 0, "a\nb\nc\n", true), host.saveDocument(doc.token!, 0, "x\n", true)]);
    expect(first).toMatchObject({ outcome: "saved", eol: "lf" });
    expect(second).toEqual({ outcome: "failed", code: "busy" });
    expect(new TextDecoder().decode(handle.bytes)).toBe("a\nb\nc\n");
  });

  it("Save As binds the chosen file under a new token and revokes the old one", async () => {
    const original = new FakeHandle("notes.md", utf8("# Notes\r\n"));
    const doc = await open(original);
    saveTo = new FakeHandle("copy.md", new Uint8Array());
    saveTo.exists = false;
    const result = await host.saveDocumentAs(doc.token!, "notes.md", "# Notes\nMore.\n", false);
    expect(result).toMatchObject({ outcome: "saved", name: "copy.md", generation: 0, encoding: "utf-8", eol: "crlf" });
    if (result.outcome !== "saved") return;
    expect(result.token).not.toBe(doc.token);
    expect(new TextDecoder().decode(saveTo.bytes)).toBe("# Notes\r\nMore.\r\n");
    expect(new TextDecoder().decode(original.bytes)).toBe("# Notes\r\n");
    expect(await host.saveDocument(doc.token!, 0, "x", false)).toEqual({ outcome: "failed", code: "revoked" });
  });

  it("Save As commits at the picker: the chosen file gets the text, never an emptied file and a refusal", async () => {
    // Chromium may have emptied the chosen file by the time the picker returns, so a check after
    // it could only leave the user with nothing. The confirmed destination gets the text.
    const handle = new FakeHandle("notes.md", utf8("# Notes\n"));
    const doc = await open(handle);
    handle.outside(new Uint8Array()); // the picker emptied it
    saveTo = handle;
    expect(await host.saveDocumentAs(doc.token!, "notes.md", "# Mine\n", false)).toMatchObject({ outcome: "saved", name: "notes.md" });
    expect(new TextDecoder().decode(handle.bytes)).toBe("# Mine\n");
  });

  it("past the picker, a file that cannot be read is still written rather than refused", async () => {
    saveTo = new FakeHandle("new.md", new Uint8Array());
    const write = saveTo.getFile.bind(saveTo);
    let calls = 0;
    saveTo.getFile = async () => { if (calls++ === 0) throw new DOMException("busy", "NoModificationAllowedError"); return write(); };
    expect(await host.saveDocumentAs(null, "new.md", "# A\n", false)).toMatchObject({ outcome: "saved", name: "new.md" });
    expect(new TextDecoder().decode(saveTo.bytes)).toBe("# A\n");
  });

  it("Save As of a new document writes UTF-8 with LF; a canceled picker writes nothing", async () => {
    saveTo = new FakeHandle("plan.md", new Uint8Array());
    expect(await host.saveDocumentAs(null, "Untitled.md", "# A\n", false)).toMatchObject({ outcome: "saved", name: "plan.md", encoding: "utf-8", eol: "lf" });
    expect(new TextDecoder().decode(saveTo.bytes)).toBe("# A\n");
    saveTo = null;
    expect(await host.saveDocumentAs(null, "Untitled.md", "# A\n", false)).toEqual({ outcome: "canceled" });
  });

  it("Save As offers only the document's kind of extension, as the native dialog does", async () => {
    const offered = () => (window as unknown as { showSaveFilePicker: ReturnType<typeof vi.fn> }).showSaveFilePicker.mock.lastCall![0];
    saveTo = new FakeHandle("notes.md", new Uint8Array());
    await host.saveDocumentAs(null, "Untitled.md", "# A\n", false);
    expect(offered()).toMatchObject({ suggestedName: "Untitled.md", excludeAcceptAllOption: true, types: [{ accept: { "text/markdown": [".md", ".markdown"] } }] });
    const data = await open(new FakeHandle("rows.csv", utf8("a,b\n")));
    saveTo = new FakeHandle("rows.tsv", new Uint8Array());
    expect(await host.saveDocumentAs(data.token!, "rows.csv", "a,b\n", false)).toMatchObject({ outcome: "saved", name: "rows.tsv" });
    expect(offered().types).toHaveLength(1);
    expect(offered().types[0].accept["text/plain"]).toContain(".tsv");
  });

  it("refuses everything it can before the picker opens, so a refusal never follows a pick", async () => {
    const doc = await open(new FakeHandle("mixed.md", utf8("a\r\nb\n")));
    saveTo = new FakeHandle("other.md", utf8("keep\n"));
    expect(await host.saveDocumentAs(doc.token!, "mixed.md", "a\nb\n", false)).toEqual({ outcome: "mixed-line-endings" });
    expect(await host.saveDocumentAs("0".repeat(32), "x.md", "a\n", false)).toEqual({ outcome: "failed", code: "revoked" });
    expect((window as unknown as { showSaveFilePicker: ReturnType<typeof vi.fn> }).showSaveFilePicker).not.toHaveBeenCalled();
    expect(new TextDecoder().decode(saveTo.bytes)).toBe("keep\n");
  });

  it("a touched file with the same bytes is not an outside change", async () => {
    const handle = new FakeHandle("notes.md", utf8("# Notes\n"));
    const doc = await open(handle);
    handle.modified += 500; // touched, same content
    expect(await host.saveDocument(doc.token!, 0, "# Mine\n", false)).toMatchObject({ outcome: "saved" });
  });

  it("asks for write permission and keeps the text when the browser refuses", async () => {
    const handle = new FakeHandle("notes.md", utf8("# Notes\n"));
    const doc = await open(handle);
    const asked: string[] = [];
    Object.assign(handle, {
      queryPermission: async ({ mode }: { mode: string }) => mode === "read" ? "granted" : "prompt",
      requestPermission: async ({ mode }: { mode: string }) => { asked.push(mode); return "denied"; },
    });
    expect(await host.saveDocument(doc.token!, 0, "# Mine\n", false)).toEqual({ outcome: "failed", code: "permission-denied" });
    expect(asked).toEqual(["readwrite"]);
    expect(handle.writes).toBe(0);
  });

  it("binds dropped files by handle, and opens a drop with no file behind it as copies", async () => {
    const file = (name: string) => new File(["# D\n"], name);
    const item = (name: string, handle: FakeHandle | null) => ({ kind: "file", getAsFile: () => file(name), getAsFileSystemHandle: async () => handle });
    const bound = await host.openDropped!([item("a.md", new FakeHandle("a.md", utf8("# A\n")))] as unknown as DataTransferItemList);
    expect(bound).toMatchObject({ documents: [{ name: "a.md", text: "# A\n" }], errors: [] });
    const copies = await host.openDropped!([item("a.md", new FakeHandle("a.md", utf8("# A\n"))), item("b.md", null)] as unknown as DataTransferItemList);
    expect(copies && "copies" in copies ? copies.copies.map(copy => copy.name) : copies).toEqual(["a.md", "b.md"]);
    // Chromium resolves a synthetic or virtual item to undefined, and a request can reject: both are "no file".
    for (const odd of [async () => undefined, async () => { throw new DOMException("no", "NotAllowedError"); }]) {
      const dropped = await host.openDropped!([{ ...item("c.md", null), getAsFileSystemHandle: odd }] as unknown as DataTransferItemList);
      expect(dropped && "copies" in dropped ? dropped.copies.map(copy => copy.name) : dropped).toEqual(["c.md"]);
    }
    // An engine without handles on drop items: the shell reads them itself.
    expect(host.openDropped!([{ kind: "file", getAsFile: () => file("c.md") }] as unknown as DataTransferItemList)).toBeNull();
  });
});

describe("browser host: re-read and line patches", () => {
  it("reports unchanged, a held change and an adopted change like the native re-read", async () => {
    const handle = new FakeHandle("notes.md", utf8("# Notes\n"));
    const doc = await open(handle);
    expect(await host.readDocument(doc.token!, true, 0)).toEqual({ outcome: "unchanged" });
    handle.outside(utf8("# New\r\n"));
    expect(await host.readDocument(doc.token!, false, 0)).toMatchObject({ outcome: "changed", text: null, generation: 0 });
    // Held: Save still conflicts.
    expect(await host.saveDocument(doc.token!, 0, "# Mine\n", false)).toEqual({ outcome: "conflict", reason: "changed" });
    expect(await host.readDocument(doc.token!, true, 0)).toEqual({ outcome: "changed", text: "# New\r\n", generation: 1, encoding: "utf-8", eol: "crlf" });
    expect(await host.saveDocument(doc.token!, 1, "# Mine\n", false)).toMatchObject({ outcome: "saved" });
    expect(new TextDecoder().decode(handle.bytes)).toBe("# Mine\r\n");
    handle.exists = false;
    expect(await host.readDocument(doc.token!, true, 2)).toEqual({ outcome: "missing" });
  });

  it("patches lines byte-exact against the current file and reports an unplaced patch", async () => {
    const handle = new FakeHandle("tasks.md", utf16le("# Tasks\r\n- [ ] One\r\n- [ ] Two"));
    const doc = await open(handle);
    const saved = await host.patchDocument(doc.token!, [{ line: 3, expect: "- [ ] Two", replace: "- [x] Two" }]);
    expect(saved).toEqual({ outcome: "saved", generation: 1, text: "# Tasks\r\n- [ ] One\r\n- [x] Two" });
    expect(handle.bytes).toEqual(utf16le("# Tasks\r\n- [ ] One\r\n- [x] Two"));
    expect(await host.patchDocument(doc.token!, [{ line: 2, expect: "- [x] One", replace: "- [ ] One" }]))
      .toEqual({ outcome: "unplaced", index: 0, text: "# Tasks\r\n- [ ] One\r\n- [x] Two" });
    expect(await host.patchDocument(doc.token!, [{ line: 2, expect: "- [ ] One", replace: "a\nb" }])).toEqual({ outcome: "failed", code: "invalid" });
    // The patch moved the baseline: Save at the new generation is not an outside change.
    expect(await host.saveDocument(doc.token!, 1, "# Tasks\n", false)).toMatchObject({ outcome: "saved" });
  });

  it("a re-read overtaken by a save never installs the older bytes (#256)", async () => {
    const handle = new FakeHandle("live.md", utf8("one\n"));
    const doc = await open(handle);
    handle.outside(utf8("version A\n"));
    // The re-read captures "version A"; before it settles, a save writes "version B".
    const getFile = handle.getFile.bind(handle);
    let first = true;
    handle.getFile = async () => {
      const file = await getFile();
      if (first) {
        first = false;
        handle.outside(utf8("one\n")); // put the baseline back so the save's check passes
        handle.modified = 1_000;
        await host.saveDocument(doc.token!, 0, "version B\n", false);
      }
      return file;
    };
    const result = await host.readDocument(doc.token!, true, 0);
    expect(result).toEqual({ outcome: "changed", text: "version B\n", generation: 1, encoding: "utf-8", eol: "lf" });
  });

  it("refuses patches the native host refuses: none, too many, NUL, and two on one line", async () => {
    const handle = new FakeHandle("tasks.md", utf8("- [ ] One\n- [ ] Two\n"));
    const doc = await open(handle);
    const one = { line: 1, expect: "- [ ] One", replace: "- [x] One" };
    expect(await host.patchDocument(doc.token!, [])).toEqual({ outcome: "failed", code: "invalid" });
    expect(await host.patchDocument(doc.token!, Array.from({ length: 257 }, () => one))).toEqual({ outcome: "failed", code: "invalid" });
    expect(await host.patchDocument(doc.token!, [{ ...one, replace: "- [x] O\0ne" }])).toEqual({ outcome: "failed", code: "invalid" });
    expect(await host.patchDocument(doc.token!, [one, { ...one, replace: "- [-] One" }])).toMatchObject({ outcome: "unplaced", index: 1 });
    expect(await host.patchDocument(doc.token!, [{ ...one, expect: "- [ ] One\r" }])).toEqual({ outcome: "failed", code: "invalid" });
    // A lone surrogate cannot be written exactly: a result, never a thrown error.
    expect(await host.patchDocument(doc.token!, [{ ...one, replace: "- [x] \ud800" }])).toEqual({ outcome: "failed", code: "encoding" });
    expect(handle.writes).toBe(0);
  });

  it("a patch on a mixed-ending file keeps it mixed, so a later Save still asks first", async () => {
    const handle = new FakeHandle("tasks.md", utf8("# Tasks\r\n- [ ] One\n"));
    const doc = await open(handle);
    expect(doc.eol).toBe("mixed");
    expect(await host.patchDocument(doc.token!, [{ line: 2, expect: "- [ ] One", replace: "- [x] One" }])).toMatchObject({ outcome: "saved" });
    expect(new TextDecoder().decode(handle.bytes)).toBe("# Tasks\r\n- [x] One\n");
    handle.outside(utf8("# Tasks\r\n- [x] One\n"), true); // same bytes, newer read
    expect(await host.readDocument(doc.token!, true, 0)).toMatchObject({ outcome: "changed", eol: "mixed" });
    expect(await host.saveDocument(doc.token!, 1, "# Tasks\n- [x] One\n", false)).toEqual({ outcome: "mixed-line-endings" });
  });

  it("a reload that adopts an outside change while Save waits never lets the save write over it", async () => {
    const handle = new FakeHandle("notes.md", utf8("# Notes\n"));
    const doc = await open(handle);
    // While Save waits for write permission, another program writes and a reload adopts it.
    Object.assign(handle, {
      queryPermission: async ({ mode }: { mode: string }) => {
        if (mode === "readwrite") {
          handle.outside(utf8("# Theirs\n"));
          expect(await host.readDocument(doc.token!, true, 0)).toMatchObject({ outcome: "changed", text: "# Theirs\n", generation: 1 });
        }
        return "granted";
      },
    });
    expect(await host.saveDocument(doc.token!, 0, "# Mine, from the old text\n", false)).toEqual({ outcome: "conflict", reason: "changed" });
    expect(new TextDecoder().decode(handle.bytes)).toBe("# Theirs\n");
    expect(handle.writes).toBe(0);
  });

  it("a released token can no longer save or re-read", async () => {
    const doc = await open(new FakeHandle("notes.md", utf8("# Notes\n")));
    await host.releaseDocument(doc.token!);
    expect(await host.readDocument(doc.token!, true, 0)).toEqual({ outcome: "failed", code: "revoked" });
    expect(await host.saveDocument(doc.token!, 0, "x", false)).toEqual({ outcome: "failed", code: "revoked" });
  });
});

describe("browser host: PDFs (PDF_WORKBENCH.md, P1b)", () => {
  const pdf = utf8("%PDF-1.7\n1 0 obj\n<< >>\nendobj\n%%EOF\n");

  it("opens a PDF as kind pdf without decoding it, reads its bytes by token, and forgets it on release", async () => {
    const handle = new FakeHandle("report.PDF", pdf);
    pick = [handle];
    const batch = await host.open();
    expect(batch.errors).toEqual([]);
    const doc = batch.documents[0]!;
    expect(doc).toMatchObject({ name: "report.PDF", text: "", kind: "pdf", bytes: pdf.length });
    expect(Array.from(await host.readPdf(doc.token!))).toEqual(Array.from(pdf));
    // A PDF token is not a text binding: Save refuses it.
    expect(await host.saveDocument(doc.token!, 0, "text", true)).toMatchObject({ outcome: "failed" });
    await host.releasePdf(doc.token!);
    await expect(host.readPdf(doc.token!)).rejects.toThrow("revoked");
  });

  it("refuses a file named .pdf that is not a PDF, and a PDF changed after it was opened", async () => {
    const fake = new FakeHandle("fake.pdf", utf8("# not a pdf"));
    const real = new FakeHandle("real.pdf", pdf);
    pick = [fake, real];
    const batch = await host.open();
    expect(batch.errors).toEqual([{ name: "fake.pdf", message: "This file is not a PDF." }]);
    real.outside(utf8("%PDF-1.7\nchanged\n"));
    await expect(host.readPdf(batch.documents[0]!.token!)).rejects.toThrow("changed");
  });
});
