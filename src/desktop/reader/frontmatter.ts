import { frontMatterProblems, type FrontMatter } from "../../render/frontmatter";

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/**
 * The reader's collapsible Properties card. Built with textContent only: front matter is
 * untrusted document text and never passes through innerHTML. Opens itself when it has problems.
 */
export function frontMatterCard(frontMatter: FrontMatter, fileName: string): HTMLElement {
  const problems = frontMatterProblems(fileName, frontMatter);
  const card = node("details", "reader-properties");
  card.open = problems.length > 0;
  if (frontMatter.lineCount) card.dataset.src = `1-${frontMatter.lineCount}`;
  const summary = node("summary", "reader-properties-summary", "Properties");
  const fields = frontMatter.entries?.length;
  if (fields) summary.append(node("span", "reader-properties-meta", `${fields} ${fields === 1 ? "field" : "fields"}`));
  if (problems.length) {
    summary.append(node("span", "reader-properties-alert", `${problems.length} ${problems.length === 1 ? "problem" : "problems"}`));
  }
  card.append(summary);
  if (problems.length) {
    const list = node("ul", "reader-properties-problems");
    for (const problem of problems) list.append(node("li", "", `Line ${problem.line}: ${problem.message}`));
    card.append(list);
  }
  if (frontMatter.entries?.length) {
    const fieldsList = node("dl", "reader-properties-fields");
    for (const entry of frontMatter.entries) {
      const value = node("dd", "");
      if (Array.isArray(entry.value)) {
        for (const item of entry.value) value.append(node("span", "reader-properties-item", item));
      } else {
        value.textContent = entry.value;
      }
      fieldsList.append(node("dt", "", entry.key), value);
    }
    card.append(fieldsList);
  } else if (frontMatter.entries === null && frontMatter.raw) {
    card.append(node("pre", "reader-properties-raw", frontMatter.raw));
  }
  return card;
}
