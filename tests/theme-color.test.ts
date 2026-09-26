import { describe, it, expect } from "vitest";
import { THEME_COLORS, syncThemeColor, themeColorFor } from "../src/app/themeColor";

describe("themeColor", () => {
  it("maps every screen theme onto its toolbar surface (--bg-toolbar in app.css)", () => {
    expect(THEME_COLORS).toEqual({
      light: "#ffffff",
      dark: "#1d2026",
      sepia: "#f7f0e1",
    });
  });

  it("degrades an unknown theme to light instead of emitting garbage", () => {
    expect(themeColorFor("neon" as never)).toBe("#ffffff");
  });

  it("syncThemeColor rewrites the theme-color meta in place", () => {
    document.head.innerHTML = `<meta name="theme-color" content="#ffffff">`;
    syncThemeColor("dark");
    expect(
      document.querySelector("meta[name='theme-color']")?.getAttribute("content"),
    ).toBe("#1d2026");
    syncThemeColor("sepia");
    expect(
      document.querySelector("meta[name='theme-color']")?.getAttribute("content"),
    ).toBe("#f7f0e1");
  });

  it("syncThemeColor no-ops when the meta is absent", () => {
    document.head.innerHTML = "";
    expect(() => syncThemeColor("dark")).not.toThrow();
  });
});
