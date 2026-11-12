import type { JsonValue } from "./json";
import type { Problem } from "./types";

type Yaml = typeof import("yaml");
type Node = import("yaml").Node;
const coreTags = new Set(["str", "null", "bool", "int", "float", "seq", "map"].map(t => `tag:yaml.org,2002:${t}`));
let reader: Yaml | undefined;
let loading: Promise<void> | undefined;
class YamlProblem extends Error {
  constructor(readonly problem: Problem) { super(problem.message); }
}

export function prepareYaml(): Promise<void> {
  return loading ??= import("yaml").then(module => { reader = module; });
}

export interface YamlResult { values: JsonValue[]; problems: Problem[]; invalid: boolean }

/** Walk source nodes, never toJS(): aliases stay leaves, including cyclic aliases. */
export function parseYaml(text: string): YamlResult {
  // A caller bug, not bad input: an empty or partial view would look like data. Fail loudly.
  if (!reader) throw new Error('toReadable(text, "yaml") needs `await prepare("yaml")` first.');
  const yaml = reader;
  const counter = new yaml.LineCounter();
  const problems: Problem[] = [];
  const position = (offset: number): { line: number; column: number } => {
    const p = counter.linePos(offset);
    return { line: p.line, column: p.col };
  };
  const source = (node: Node): string => node.range ? text.slice(node.range[0], node.range[1]) : "";
  function convert(node: unknown, offset = 0, depth = 0, prefix: import("yaml").CST.SourceToken[] = [], tagName = (tag: string): string => tag): JsonValue {
    const start = yaml.isNode(node) ? node.range?.[0] ?? offset : offset;
    const pos = position(start);
    if (depth > 512) throw new YamlProblem({ message: "YAML nesting exceeds the maximum depth of 512", ...pos });
    if (!yaml.isNode(node)) return { ...pos, kind: "literal", raw: "" };
    if (yaml.isAlias(node)) return { ...pos, kind: "literal", raw: `alias of &${node.source}` };
    // Preserve the spelling of local tags and %TAG handles from the CST, not their expanded URI.
    const tagToken = prefix.find(t => t.type === "tag");
    if (node.tag && !coreTags.has(node.tag)) {
      const tag = tagToken?.source ?? tagName(node.tag);
      const value = yaml.isScalar(node) && typeof node.value === "string" ? node.value : source(node);
      return { ...pos, kind: "literal", raw: `${tag} ${value}` };
    }
    if (yaml.isMap(node)) {
      const token = node.srcToken;
      return { ...pos, kind: "object", entries: node.items.map((pair, index) => {
        const item = token && "items" in token ? token.items[index] : undefined;
        const keyNode = pair.key;
        const key = yaml.isScalar(keyNode) ? typeof keyNode.value === "string" ? keyNode.value : source(keyNode)
          : yaml.isNode(keyNode) ? source(keyNode) : "";
        const sep = item && "sep" in item ? item.sep ?? [] : [];
        return { key, value: convert(pair.value, start, depth + 1, sep, tagName) };
      }) };
    }
    if (yaml.isSeq(node)) {
      const token = node.srcToken;
      return { ...pos, kind: "array", items: node.items.map((item, index) =>
        convert(item, start, depth + 1, token && "items" in token ? token.items[index]?.start ?? [] : [], tagName)) };
    }
    if (yaml.isScalar(node)) {
      const raw = node.source ?? source(node);
      if (typeof node.value === "string") {
        // Core YAML 1.2 does not resolve digit separators, but they are numeric source scalars.
        if (node.type === "PLAIN" && node.tag !== "tag:yaml.org,2002:str"
          && /^[+-]?\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?(?:[eE][+-]?\d(?:_?\d)*)?$/.test(raw)) {
          return { ...pos, kind: "number", raw };
        }
        return { ...pos, kind: "string", value: node.value };
      }
      return { ...pos, kind: typeof node.value === "number" || typeof node.value === "bigint" ? "number" : "literal", raw };
    }
    return { ...pos, kind: "literal", raw: source(node) };
  }
  try {
    const docs = yaml.parseAllDocuments(text, { keepSourceTokens: true, lineCounter: counter, uniqueKeys: false, intAsBigInt: true, prettyErrors: false });
    for (const doc of docs) {
      for (const error of [...doc.errors, ...doc.warnings]) {
        problems.push({ message: error.message.split("\n")[0]!, ...position(error.pos[0]) });
      }
    }
    const invalid = docs.some(doc => doc.errors.length > 0);
    if (invalid) return { values: [], problems, invalid };
    const values = docs.map(doc => {
      const token = doc.contents?.srcToken;
      const offset = token?.offset ?? doc.range?.[0] ?? 0;
      return convert(doc.contents, offset, 0, [], tag => doc.directives.tagString(tag));
    });
    return { values: values.length ? values : [{ kind: "literal", raw: "", line: 1, column: 1 }], problems, invalid: false };
  } catch (error) {
    const problem = error instanceof YamlProblem ? error.problem : { message: error instanceof Error ? error.message : "Invalid YAML", line: 1, column: 1 };
    return { values: [], problems: [...problems, problem], invalid: true };
  }
}
