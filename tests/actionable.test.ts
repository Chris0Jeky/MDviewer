import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyPatches, nextMark, nextOption, parseActionable, planChange, splitLines, type Control,
} from "../src/render/actionable";

const DIR = resolve("tests/fixtures/actionable");
const read = (name: string): string => readFileSync(resolve(DIR, name), "utf8");
const names = readdirSync(DIR).filter(file => file.endsWith(".md")).map(file => file.slice(0, -3));

interface Item { kind: string; line: number; id?: string; state?: string; value?: string; key?: string; group?: number; options?: string[] }
interface Change {
  name: string;
  target: { id?: string; line?: number };
  action: Parameters<typeof planChange>[3];
  patches: Array<{ line: number; id?: string; expect: string; replace: string }>;
  after: string;
}

/** The fixture's view of a control: the fields items.json lists. */
function item(control: Control): Item {
  const { line, id, kind } = control;
  const base = { kind, line, ...(id ? { id } : {}) };
  if (control.kind === "mark") return { ...base, state: control.state };
  if (control.kind === "choice") return { ...base, state: control.state, group: control.group };
  if (control.kind === "field") return { ...base, key: control.key, value: control.value };
  return { ...base, key: control.key, value: control.value, options: control.options };
}

describe("actionable Markdown conformance fixtures", () => {
  it("covers every fixture with items and patches", () => {
    expect(names.sort()).toEqual(["bom-crlf", "chips", "choices", "fields", "marks", "tasks"]);
  });

  for (const name of names) {
    describe(name, () => {
      const text = read(`${name}.md`);
      const document = parseActionable(text);

      it("finds exactly the listed controls", () => {
        expect(document.controls.map(item)).toEqual(JSON.parse(read(`${name}.items.json`)));
      });

      for (const change of JSON.parse(read(`${name}.patches.json`)) as Change[]) {
        it(`${change.name}: plans the listed patches and writes the exact bytes`, () => {
          const control = document.controls.find(candidate =>
            change.target.id ? candidate.id === change.target.id : candidate.line === change.target.line)!;
          expect(control).toBeDefined();
          const patches = planChange(text, document, control, change.action);
          expect(patches).toEqual(change.patches);
          expect(applyPatches(text, patches)).toBe(change.after);
        });
      }
    });
  }
});

describe("actionable Markdown rules", () => {
  it("reads the declared cycle and version, and reports duplicate ids", () => {
    const document = parseActionable(read("marks.md"));
    expect(document.cycle).toEqual([" ", "/", "x"]);
    expect(document.version).toBe(1);
    expect(document.problems).toEqual([expect.stringMatching(/"twin" is used 2 times/)]);
    expect(parseActionable("- [ ] a\n").cycle).toEqual([" ", "x"]);
  });

  it("refuses an invalid cycle and warns about a newer version", () => {
    const document = parseActionable('---\nactionable: 2\nmarks: ["/", "x"]\n---\n- [ ] a\n');
    expect(document.cycle).toEqual([" ", "x"]);
    expect(document.problems).toEqual([
      expect.stringMatching(/"marks" must list/),
      expect.stringMatching(/actionable: 2; this MDviewer supports version 1/),
    ]);
  });

  it("cycles marks and chip options", () => {
    expect(nextMark(" ", [" ", "x"])).toBe("x");
    expect(nextMark("x", [" ", "x"])).toBe(" ");
    expect(nextMark("/", [" ", "x"])).toBeNull(); // not in the cycle: open the menu
    expect(nextOption("done", ["draft", "review", "done"])).toBe("draft");
    expect(nextOption("urgent", ["low", "high"])).toBe("low");
  });

  it("refuses line breaks and stale lines", () => {
    const text = "owner:: Ada\n";
    const document = parseActionable(text);
    expect(() => planChange(text, document, document.controls[0]!, { kind: "field", value: "a\nb" })).toThrow(/line break/);
    const patches = planChange(text, document, document.controls[0]!, { kind: "field", value: "Lin" });
    expect(() => applyPatches("owner:: Grace\n", patches)).toThrow(/cannot be placed/);
  });

  it("quotes a plain chip value only when it would change meaning", () => {
    const text = "---\nstate: a\nstate.options: [a, \"b: c\"]\n---\n";
    const document = parseActionable(text);
    const [patch] = planChange(text, document, document.controls[0]!, { kind: "chip", value: "b: c" });
    expect(patch!.replace).toBe('state: "b: c"');
  });

  it("splits lines exactly as markdown-it numbers them", () => {
    expect(splitLines("\uFEFFa\r\nb\rc\nd")).toEqual({ bom: "\uFEFF", lines: ["a", "b", "c", "d"], eols: ["\r\n", "\r", "\n", ""] });
  });

  it("keeps controls out of code, HTML blocks and plain prose", () => {
    const text = "<div>\n- [ ] html\n</div>\n\nText [ ] and (x) here.\n\n> key:: quoted field\n";
    expect(parseActionable(text).controls.map(control => [control.kind, control.line])).toEqual([["field", 7]]);
  });
});

describe("actionable glyphs in the shared renderer", () => {
  it("leave ordinary task lists exactly as GitHub task lists render them", async () => {
    const { createMarkdown, renderMarkdown } = await import("../src/render/markdown");
    const { DEFAULT_SETTINGS } = await import("../src/app/settings");
    const html = renderMarkdown(createMarkdown(null, DEFAULT_SETTINGS), "- [ ] a\n- [x] b\n").html;
    expect(html).not.toContain("am-");
    expect(html.match(/task-list-item-checkbox/g)).toHaveLength(2);
  });

  it("draw the other marks and choices as named glyphs", async () => {
    const { createMarkdown, renderMarkdown } = await import("../src/render/markdown");
    const { DEFAULT_SETTINGS } = await import("../src/app/settings");
    const html = renderMarkdown(createMarkdown(null, DEFAULT_SETTINGS), "- [/] a\n- [-] b\n- (x) c\n\nnot [/] at start\n").html;
    expect(html).toContain('data-mark="/" role="img" aria-label="In progress"');
    expect(html).toContain('class="am-dropped task-list-item am-item"');
    expect(html).toContain('class="am-radio am-checked" role="img" aria-label="Selected"');
    expect(html).toContain("not [/] at start");
  });
});

describe("actionable review fixes", () => {
  it("an empty chip scalar gains the space that keeps it a YAML pair", () => {
    const text = "---\nstatus:\nstatus.options: [draft, done]\n---\n";
    const document = parseActionable(text);
    const patches = planChange(text, document, document.controls[0]!, { kind: "chip", value: "draft" });
    const after = applyPatches(text, patches);
    expect(after).toBe("---\nstatus: draft\nstatus.options: [draft, done]\n---\n");
    expect(parseActionable(after).controls[0]).toMatchObject({ kind: "chip", value: "draft" });
  });

  it("lines inside a multi-line code span are not fields", () => {
    const text = "Run `this\nowner:: Ada <!-- id: a -->\nend` then.\nreal:: yes <!-- id: a -->\n";
    const document = parseActionable(text);
    expect(document.controls).toEqual([expect.objectContaining({ kind: "field", key: "real", line: 4, id: "a" })]);
    expect(document.problems).toEqual([]);
  });
});

describe("actionable parser robustness", () => {
  it("stays fast on deeply nested quote prefixes", () => {
    const started = performance.now();
    parseActionable("> ".repeat(60) + "x\n" + "> ".repeat(60) + "- [ ] y\n");
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("agrees with the app's own parse for every fixture and for math blocks", async () => {
    const { createMarkdown } = await import("../src/render/markdown");
    const { DEFAULT_SETTINGS } = await import("../src/app/settings");
    const { readFrontMatter } = await import("../src/render/frontmatter");
    for (const text of [...names.map(name => read(`${name}.md`)), "$$\nkey:: x\n$$\n\nreal:: y\n"]) {
      const tokens = createMarkdown(null, DEFAULT_SETTINGS).parse(readFrontMatter(text).body, {});
      expect(parseActionable(text, tokens).controls.map(item)).toEqual(parseActionable(text).controls.map(item));
    }
    expect(parseActionable("$$\nkey:: x\n$$\n").controls).toEqual([]);
  });

  it("quotes a chip value that ends in a colon", () => {
    const text = "---\nk: a\nk.options: [a, \"b:\"]\n---\n";
    const document = parseActionable(text);
    expect(planChange(text, document, document.controls[0]!, { kind: "chip", value: "b:" })[0]!.replace).toBe('k: "b:"');
  });
});
