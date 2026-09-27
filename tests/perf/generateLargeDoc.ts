/**
 * Deterministic large-document generator for performance profiling.
 *
 * `generateLargeDoc` builds a representative Markdown stress document: headings,
 * prose, fenced code (rotating languages), tables, callouts, task lists, math,
 * footnotes and the occasional Mermaid diagram — the block mix whose pagination
 * cost the production performance budget is set from. Output is a pure function
 * of `(targetBytes, seed)` so profile runs are reproducible.
 */

/** Mulberry32: small seeded PRNG, stable across V8 versions for our use. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = (
  "render paginate layout margin typography sheet viewport scroll theme export print " +
  "preview editor document section paragraph heading code table figure caption footnote " +
  "margin note callout warning tip danger quote list item task checkbox link emphasis " +
  "strong delete anchor slug toc index glossary appendix chapter volume pixel point " +
  "column row cell border padding bleed trim spine gutter orphan widow fragment flow"
).split(" ");

const CODE_LANGS = ["ts", "python", "rust", "go", "csharp", "bash", "json"];

const CODE_SNIPPETS: Record<string, string[]> = {
  ts: [
    "export function paginate(source: string): Page[] {\n  return chunk(measure(parse(source)));\n}",
    "const total = pages.reduce((n, p) => n + p.blocks.length, 0);",
  ],
  python: [
    "def paginate(source):\n    return chunk(measure(parse(source)))",
    "total = sum(len(p.blocks) for p in pages)",
  ],
  rust: [
    "pub fn paginate(source: &str) -> Vec<Page> {\n    chunk(measure(parse(source)))\n}",
    "let total: usize = pages.iter().map(|p| p.blocks.len()).sum();",
  ],
  go: [
    "func paginate(source string) []Page {\n\treturn chunk(measure(parse(source)))\n}",
    "total := 0\nfor _, p := range pages {\n\ttotal += len(p.Blocks)\n}",
  ],
  csharp: [
    "public record Page(int Index, Block[] Blocks);",
    "var total = pages.Sum(p => p.Blocks.Length);",
  ],
  bash: ["npm run build\nnpm run test -- --run", "set -euo pipefail\necho done"],
  json: ['{ "page": 1, "blocks": ["h2", "pre", "table"] }', '{ "ok": true }'],
};

function sentence(rand: () => number, words: number): string {
  const picked: string[] = [];
  for (let i = 0; i < words; i += 1) {
    picked.push(WORDS[Math.floor(rand() * WORDS.length)]!);
  }
  picked[0] = picked[0]![0]!.toUpperCase() + picked[0]!.slice(1);
  return picked.join(" ") + ".";
}

function paragraph(rand: () => number): string {
  const count = 3 + Math.floor(rand() * 4);
  return Array.from({ length: count }, () => sentence(rand, 8 + Math.floor(rand() * 14))).join(" ");
}

function codeFence(index: number): string {
  const lang = CODE_LANGS[index % CODE_LANGS.length]!;
  const snippets = CODE_SNIPPETS[lang]!;
  const body = snippets[index % snippets.length]!;
  return "```" + lang + "\n" + body + "\n```";
}

function table(rand: () => number): string {
  const rows = 4 + Math.floor(rand() * 5);
  const head = "| Block | Width | Keep whole |";
  const rule = "| --- | ---: | :---: |";
  const lines = [head, rule];
  for (let r = 0; r < rows; r += 1) {
    lines.push(
      `| ${WORDS[Math.floor(rand() * WORDS.length)]} | ${(rand() * 100).toFixed(1)} | ${r % 2 === 0 ? "yes" : "no"} |`,
    );
  }
  return lines.join("\n");
}

function callout(rand: () => number): string {
  // markdown-it-container form (src/render/markdown.ts CALLOUTS): GitHub-style
  // `> [!kind]` would render as a plain blockquote with no .callout element.
  const kinds = ["note", "tip", "warning", "danger"];
  const kind = kinds[Math.floor(rand() * kinds.length)]!;
  const title = kind[0]!.toUpperCase() + kind.slice(1);
  return `:::${kind} ${title}\n${sentence(rand, 12)}\n:::`;
}

function mermaid(index: number): string {
  return (
    "```mermaid\nflowchart LR\n" +
    `  A${index}[Source] --> B${index}[Render]\n` +
    `  B${index} --> C${index}[Paginate]\n` +
    `  C${index} --> D${index}[Export]\n` +
    "```"
  );
}

function section(rand: () => number, index: number): string {
  const parts = [
    `## Section ${index}: ${sentence(rand, 4).replace(/\.$/, "")}`,
    "",
    paragraph(rand),
    "",
    paragraph(rand),
    "",
    codeFence(index),
    "",
    table(rand),
    "",
    callout(rand),
    "",
    `- [${index % 3 === 0 ? "x" : " "}] ${sentence(rand, 6)}`,
    `- [ ] ${sentence(rand, 6)}`,
    "",
    `Inline math $E = m c^${(index % 4) + 1}$ and display math:`,
    "",
    "$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$",
    "",
  ];
  // A Mermaid diagram every ~8 sections: async render cost without dominating.
  if (index % 8 === 3) parts.push(mermaid(index), "");
  // Footnote references every ~5 sections; definitions are appended at the end.
  if (index % 5 === 1) parts.push(`A claim needing citation.[^fn${index}]`, "");
  return parts.join("\n");
}

/**
 * Build a deterministic stress document of at least `targetBytes` UTF-8 bytes.
 * Overshoot is bounded by one section plus one footnote definition (under
 * 8 kB): the trailing "## Notes" block is counted toward the target as its
 * definitions accumulate, not only when appended. Sections are numbered from 1.
 */
export function generateLargeDoc(targetBytes: number, seed = 20260926): string {
  if (!Number.isInteger(targetBytes) || targetBytes <= 0) {
    throw new Error(`targetBytes must be a positive integer; received ${targetBytes}`);
  }
  const rand = mulberry32(seed);
  const chunks: string[] = [
    "# Performance stress document",
    "",
    "[[toc]]",
    "",
    "> Generated deterministically: same bytes in, same profile out.",
    "",
  ];
  const footnoteDefs: string[] = [];
  let index = 0;
  let bytes = Buffer.byteLength(chunks.join("\n"), "utf8");
  // Byte size the trailing "## Notes" block will add once joined: its content
  // plus one "\n" separator per pushed element.
  let pendingNotes = 0;
  while (bytes + pendingNotes < targetBytes) {
    index += 1;
    const body = section(rand, index);
    chunks.push(body);
    if (index % 5 === 1) {
      if (footnoteDefs.length === 0) {
        pendingNotes += Buffer.byteLength("## Notes", "utf8") + 3;
      }
      const def = `[^fn${index}]: ${sentence(rand, 10)}`;
      footnoteDefs.push(def);
      pendingNotes += Buffer.byteLength(def, "utf8") + 1;
    }
    bytes += Buffer.byteLength(body, "utf8") + 1;
  }
  if (footnoteDefs.length > 0) chunks.push("## Notes", "", ...footnoteDefs, "");
  return chunks.join("\n");
}
