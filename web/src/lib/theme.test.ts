import { describe, expect, it } from "vitest";
import { cssVariableName, generateThemeVariables, resolveSeed, SEED_COLOR } from "./theme";

describe("theme", () => {
  it("builds kebab-case variable names", () => {
    expect(cssVariableName("primary")).toBe("--md-sys-color-primary");
    expect(cssVariableName("onPrimaryContainer")).toBe("--md-sys-color-on-primary-container");
  });

  it("generates different light and dark colours from the seed", () => {
    const { light, dark } = generateThemeVariables(SEED_COLOR);
    expect(light["--md-sys-color-primary"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(dark["--md-sys-color-primary"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(light["--md-sys-color-surface"]).not.toBe(dark["--md-sys-color-surface"]);
  });

  it("generates different colours for different seeds", () => {
    const purple = generateThemeVariables("#6750a4").light["--md-sys-color-primary"];
    const green = generateThemeVariables("#2e7d32").light["--md-sys-color-primary"];
    expect(purple).not.toBe(green);
  });
});

describe("resolveSeed", () => {
  it("uses the user's seed colour", () => {
    expect(resolveSeed("#2e7d32")).toBe("#2e7d32");
    expect(resolveSeed("#2E7D32")).toBe("#2e7d32");
  });

  it.each([null, undefined, "", "green", "#12345", "#gggggg", "rgb(1,2,3)"])("falls back to the default for %j", (seed) => {
    expect(resolveSeed(seed)).toBe(SEED_COLOR);
  });
});
