import { describe, expect, it } from "vitest";
import {
  imageType, isAgentData, isAgentFile, isMarkdownName, isScanned, isSkippedFolder, isTemplate, resolveReference, withMarkdownExtension,
} from "../src/desktop/hosts/paths";

/** The browser host's folder rules (web parity W4), mirroring `assets.rs` and `library.rs`. */
const doc = ["docs", "guide", "intro.md"];

describe("resolveReference: assets::resolve inside the granted folder", () => {
  it("resolves relative paths, imports, separators, encoding, ./ and ../, and drops fragments and queries", () => {
    expect(resolveReference(doc, "next.md")).toEqual(["docs", "guide", "next.md"]);
    expect(resolveReference(doc, "./a/b.md#part")).toEqual(["docs", "guide", "a", "b.md"]);
    expect(resolveReference(doc, "../other.md?x=1")).toEqual(["docs", "other.md"]);
    expect(resolveReference(doc, "@CLAUDE.md")).toEqual(["docs", "guide", "CLAUDE.md"]);
    expect(resolveReference(doc, "..\\..\\README.md")).toEqual(["README.md"]);
    expect(resolveReference(doc, "my%20notes.md")).toEqual(["docs", "guide", "my notes.md"]);
    expect(resolveReference(doc, "img//pic.png")).toEqual(["docs", "guide", "img", "pic.png"]);
  });

  it("never climbs above the granted folder", () => {
    expect(resolveReference(doc, "../../../outside.md")).toBeNull();
    expect(resolveReference(["top.md"], "../x.md")).toBeNull();
    expect(resolveReference(doc, "../../..")).toBeNull();
  });

  it("refuses URLs, drive and rooted forms, control characters, bad encoding and empty references", () => {
    for (const bad of ["https://example.com/x.md", "C:\\x.md", "c:x.md", "/etc/passwd", "\\\\server\\share\\x.md", "%2Fetc%2Fpasswd",
      "%5C%5Cserver%5Cx.md", "a%3Ab.md", "x%00.md", "%E0%A4%A", "", "   ", "#only", "@", "?q"]) {
      expect(resolveReference(doc, bad), bad).toBeNull();
    }
  });
});

describe("link targets, images and the scan", () => {
  it("adds .md to a wiki name and opens Markdown targets only", () => {
    expect(withMarkdownExtension(["docs", "Plan"])).toEqual(["docs", "Plan.md"]);
    expect(withMarkdownExtension(["notes.markdown"])).toEqual(["notes.markdown"]);
    expect(["a.md", "B.MARKDOWN"].map(isMarkdownName)).toEqual([true, true]);
    expect(["a.json", "a.txt", "md", ".md"].map(isMarkdownName)).toEqual([false, false, false, false]);
  });

  it("knows the image types and nothing else", () => {
    expect(["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp", "f.svg"].map(imageType))
      .toEqual(["image/png", "image/jpeg", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]);
    expect(["a.bmp", "a.html", "png"].map(imageType)).toEqual([null, null, null]);
  });

  it("skips build and dependency folders and the worktree checkouts, and keeps dot-folders", () => {
    for (const skip of [["node_modules"], ["a", ".git"], ["target"], ["dist"], ["build"], [".venv"], [".claude", "worktrees"]]) {
      expect(isSkippedFolder(skip), skip.join("/")).toBe(true);
    }
    for (const keep of [[".claude"], ["docs", "worktrees"], ["src"], [".codex"]]) expect(isSkippedFolder(keep), keep.join("/")).toBe(false);
  });

  it("lists Markdown and agent data, never credential stores", () => {
    expect(isScanned(["docs", "a.md"])).toBe(true);
    expect(isScanned([".claude", "settings.json"])).toBe(true);
    expect(isScanned([".mcp.json"])).toBe(true);
    expect(isScanned(["src", "data.json"])).toBe(false);
    expect(isScanned(["sub", ".mcp.json"])).toBe(false);
    expect(isAgentData([".claude", "credentials.json"])).toBe(false);
    expect(isAgentData([".codex", "auth.json"])).toBe(false);
    expect(isAgentData([".agent-harness", "tier.json"])).toBe(true);
  });

  it("marks agent files and templates as the native scan does", () => {
    expect(["CLAUDE.md", "AGENTS.md", "x/SKILL.md", "MEMORY.md", "HUMAN_TODO.md", "ACTION_ITEMS.md", "ORCHESTRATOR.md"]
      .map(path => isAgentFile(path.split("/")))).toEqual([true, true, true, true, true, true, true]);
    expect(isAgentFile([".claude", "agents", "reviewer.md"])).toBe(true);
    expect(isAgentFile(["memory", "note.md"])).toBe(true);
    expect(isAgentFile(["docs", "readme.md"])).toBe(false);
    expect(isTemplate(["templates", "Meeting.md"])).toBe(true);
    expect(isTemplate(["Templates", "x.markdown"])).toBe(true);
    expect(isTemplate(["templates", "deep", "x.md"])).toBe(false);
    expect(isTemplate(["docs", "templates", "x.md"])).toBe(false);
    expect(isTemplate(["templates", "x.json"])).toBe(false);
  });
});
