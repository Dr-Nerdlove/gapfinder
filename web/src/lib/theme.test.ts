import { describe, expect, it } from "vitest";
import { cssVariableName, generateThemeVariables, SEED_COLOR } from "./theme";

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
});
