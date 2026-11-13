// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Pagination leans on Paged.js 0.4.3 internals (docs/design/IMPLEMENTATION_SPEC.md §4,
// issue #242): the undisplayed-mark filter, layout's column-gap math, break-inside
// reads and the "Layout repeated" return. A caret range would let a routine install pick
// up a release those assumptions were never rechecked against.
const CHECKED_AGAINST = "0.4.3";

const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

it("pins Paged.js to the exact release its internals were checked against", () => {
  const manifest = readJson("../package.json");
  const lock = readJson("../package-lock.json");
  const installed = readJson("../node_modules/pagedjs/package.json");
  expect(manifest.dependencies.pagedjs, "package.json range").toBe(CHECKED_AGAINST);
  expect(lock.packages[""].dependencies.pagedjs, "package-lock.json root range").toBe(CHECKED_AGAINST);
  expect(installed.version, "installed release").toBe(CHECKED_AGAINST);
});
