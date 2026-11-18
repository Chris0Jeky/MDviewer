import { describe, expect, it } from "vitest";
import { toReadable } from "../src/data";

describe("HTML readable view (D7)", () => {
  it("stays linear on hostile input: thousands of unclosed openers (#347 review)", () => {
    for (const hostile of ["<script>".repeat(150_000), "<a ".repeat(300_000), "<title>".repeat(100_000)]) {
      const started = performance.now();
      toReadable(hostile, "html", { fileName: "x.html" });
      expect(performance.now() - started, hostile.slice(0, 10)).toBeLessThan(5_000);
    }
  });

  it("an unterminated comment cannot swallow the closing wrapper", () => {
    const view = toReadable("<p>before</p><!-- open forever <p>after</p>", "html", { fileName: "x.html" }).markdown;
    expect(view.trimEnd().endsWith("</div>")).toBe(true);
  });
});
