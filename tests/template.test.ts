import { describe, it, expect } from "vitest";
import { fillTemplate, templateFields, templateTitle } from "../src/desktop/reader/template";

const NOW = new Date(2026, 10, 12, 9, 5);

describe("templates (A4)", () => {
  it("asks for each distinct placeholder once, in order, and never for date, time or title", () => {
    const text = "# {{title}}\n\nOwner: {{owner}}\nDue: {{ due }}\nAgain: {{owner}}\nOn {{date}} at {{time}}\n";
    expect(templateFields(text)).toEqual(["owner", "due"]);
  });

  it("fills given values and the automatic ones", () => {
    const text = "# {{title}}\n\nOwner: {{owner}}, again {{owner}}\nOn {{Date}} at {{time}}\n";
    expect(fillTemplate(text, { owner: "Ada" }, NOW, "Meeting notes")).toBe(
      "# Meeting notes\n\nOwner: Ada, again Ada\nOn 2026-11-12 at 09:05\n");
  });

  it("leaves what is not a placeholder, and a name without a value, exactly as written", () => {
    const text = "Code: `{{ 1 + 1 }}`, {{-bad}}, {{missing}}, {{x}}\r\n";
    expect(fillTemplate(text, { x: "y" }, NOW, "T")).toBe("Code: `{{ 1 + 1 }}`, {{-bad}}, {{missing}}, y\r\n");
    expect(templateFields(text)).toEqual(["missing", "x"]);
  });

  it("inserts a value as written, without reading it as a placeholder again", () => {
    expect(fillTemplate("{{a}} {{b}}", { a: "{{b}}", b: "B" }, NOW, "T")).toBe("{{b}} B");
  });

  it("titles a template by its file name", () => {
    expect(templateTitle("Meeting notes.md")).toBe("Meeting notes");
    expect(templateTitle("plan.markdown")).toBe("plan");
  });
});
