import { describe, expect, it } from "vitest";
import { buildStylesheet } from "../src/paginate/cssBuilder";
import { DEFAULT_SETTINGS } from "../src/app/settings";

// Regression: a running header containing a double-quote and a backslash must
// be CSS string-escaped so the `content: "..."` declaration stays intact.
const HEADER = 'Say "hi" done \\ end';

describe("cssBuilder: running-header CSS escaping", () => {
  it.each(["\n", "\r", "\r\n"])("escapes line breaks %j as CSS newlines", (newline) => {
    const out = buildStylesheet({ ...DEFAULT_SETTINGS, runningHeader: `first${newline}aftermath` });
    expect(out).toContain('content: "first\\A aftermath";');
    expect(out).not.toContain(`first${newline}aftermath`);
  });

  it("escapes embedded quotes/backslashes without breaking the stylesheet", () => {
    const out = buildStylesheet({ ...DEFAULT_SETTINGS, runningHeader: HEADER });

    // The quote is emitted escaped, and the backslash is doubled.
    expect(out).toContain('Say \\"hi\\" done \\\\ end');

    // No unescaped break out of the content string appears.
    expect(out).not.toContain('content: "Say "hi"');

    // The stylesheet itself stays intact.
    expect(out).toMatch(/@page\b/);
  });
});
