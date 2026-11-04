import { hexFromArgb, TonalPalette } from "@material/material-color-utilities";
import { describe, expect, it } from "vitest";
import { generateThemeVariables, SEED_COLOR } from "./theme";
import { PALETTE_NAMES, parseSystemPalettes, SHADES, shadeToTone, systemThemeVariables, type SystemPalettes } from "./system-colors";

/** Palettes shaped like a phone's: the real Material tones of a hue and chroma, in Android's 13 shades. */
function fakePhone(hue: number, chroma: number): Record<string, string> {
  const palette = TonalPalette.fromHueAndChroma(hue, chroma);
  return Object.fromEntries(SHADES.map((shade) => [String(shade), hexFromArgb(palette.tone(shadeToTone(shade)))]));
}

function fakePalettes(): SystemPalettes {
  return {
    accent1: fakePhone(150, 48),
    accent2: fakePhone(160, 16),
    accent3: fakePhone(200, 24),
    neutral1: fakePhone(150, 4),
    neutral2: fakePhone(150, 8),
  };
}

describe("shadeToTone", () => {
  it.each([
    [0, 100],
    [10, 99],
    [50, 95],
    [100, 90],
    [200, 80],
    [500, 50],
    [600, 40],
    [900, 10],
    [1000, 0],
  ])("shade %i is tone %i", (shade, tone) => {
    expect(shadeToTone(shade)).toBe(tone);
  });
});

describe("systemThemeVariables", () => {
  const palettes = fakePalettes();
  const vars = systemThemeVariables(palettes)!;

  it("returns the phone's colours exactly for the roles that sit on Android's shades", () => {
    expect(vars.light["--md-sys-color-primary"]).toBe(palettes.accent1["600"]);
    expect(vars.light["--md-sys-color-on-primary"]).toBe(palettes.accent1["0"]);
    expect(vars.light["--md-sys-color-primary-container"]).toBe(palettes.accent1["100"]);
    expect(vars.light["--md-sys-color-on-primary-container"]).toBe(palettes.accent1["900"]);
    expect(vars.light["--md-sys-color-secondary-container"]).toBe(palettes.accent2["100"]);
    expect(vars.light["--md-sys-color-surface"]).toBe(palettes.neutral1["10"]);
    expect(vars.light["--md-sys-color-on-surface"]).toBe(palettes.neutral1["900"]);
    expect(vars.light["--md-sys-color-outline"]).toBe(palettes.neutral2["500"]);
    expect(vars.dark["--md-sys-color-primary"]).toBe(palettes.accent1["200"]);
    expect(vars.dark["--md-sys-color-on-primary"]).toBe(palettes.accent1["800"]);
    expect(vars.dark["--md-sys-color-surface"]).toBe(palettes.neutral1["900"]);
    expect(vars.dark["--md-sys-color-on-surface"]).toBe(palettes.neutral1["100"]);
    expect(vars.dark["--md-sys-color-surface-variant"]).toBe(palettes.neutral2["700"]);
  });

  it("has exactly the same variables as the seed path, light and dark", () => {
    const seed = generateThemeVariables(SEED_COLOR);
    expect(Object.keys(vars.light).sort()).toEqual(Object.keys(seed.light).sort());
    expect(Object.keys(vars.dark).sort()).toEqual(Object.keys(seed.dark).sort());
    for (const value of [...Object.values(vars.light), ...Object.values(vars.dark)]) expect(value).toMatch(/^#[0-9a-f]{6}$/);
    expect(vars.light["--md-sys-color-surface"]).toBeDefined();
    expect(vars.light["--md-sys-color-error"]).toBeDefined();
  });

  it("answers differently for a different phone", () => {
    const other = systemThemeVariables({
      ...palettes,
      accent1: fakePhone(300, 48),
    })!;
    expect(other.light["--md-sys-color-primary"]).not.toBe(vars.light["--md-sys-color-primary"]);
  });

  it("has dark colours that differ from the light ones", () => {
    expect(vars.dark["--md-sys-color-surface"]).not.toBe(vars.light["--md-sys-color-surface"]);
  });
});

describe("incomplete palettes", () => {
  it.each([null, undefined, "x", 3, {}, []])("are refused for %j", (value) => {
    expect(parseSystemPalettes(value)).toBeNull();
    expect(systemThemeVariables(value)).toBeNull();
  });

  it.each(PALETTE_NAMES)("are refused when %s is missing", (name) => {
    const broken: Partial<SystemPalettes> = fakePalettes();
    delete broken[name];
    expect(systemThemeVariables(broken)).toBeNull();
  });

  it("are refused when a shade is missing or not a colour", () => {
    const missing = fakePalettes();
    delete missing.accent1["600"];
    expect(systemThemeVariables(missing)).toBeNull();
    const odd = fakePalettes();
    odd.neutral2["500"] = "red";
    expect(systemThemeVariables(odd)).toBeNull();
  });

  it("are accepted in upper case and cleaned to lower case", () => {
    const upper = fakePalettes();
    upper.accent1["600"] = upper.accent1["600"]!.toUpperCase();
    expect(parseSystemPalettes(upper)!.accent1["600"]).toBe(fakePalettes().accent1["600"]);
  });
});
