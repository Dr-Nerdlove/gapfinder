import { argbFromHex, type CorePalette, Hct, Scheme, TonalPalette } from "@material/material-color-utilities";
import { schemeToCssVariables } from "./theme";

// Material You in the Android app: the phone's system palettes (Android 12+) become the same CSS variables that
// `generateThemeVariables` makes from a seed colour. Pure functions, no DOM.

export const PALETTE_NAMES = ["accent1", "accent2", "accent3", "neutral1", "neutral2"] as const;
export type PaletteName = (typeof PALETTE_NAMES)[number];

/** The shades Android's `system_<palette>_<shade>` colours come in. */
export const SHADES = [0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000] as const;

/** One system palette: shade (as text, "0" ... "1000") to `#rrggbb`. */
export type SystemPalette = Record<string, string>;
export type SystemPalettes = Record<PaletteName, SystemPalette>;

/** Android shade N is Material tone 100 - N/10 (0 = white = tone 100, 1000 = black = tone 0). */
export function shadeToTone(shade: number): number {
  return 100 - shade / 10;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Checks what the app reported: all five palettes with all 13 shades as `#rrggbb`. Returns a clean copy, or null
 * when anything is missing or odd (the caller then uses the seed colour).
 */
export function parseSystemPalettes(value: unknown): SystemPalettes | null {
  if (typeof value !== "object" || value === null) return null;
  const result: Partial<SystemPalettes> = {};
  for (const name of PALETTE_NAMES) {
    const palette = (value as Record<string, unknown>)[name];
    if (typeof palette !== "object" || palette === null) return null;
    const clean: SystemPalette = {};
    for (const shade of SHADES) {
      const hex = (palette as Record<string, unknown>)[String(shade)];
      if (typeof hex !== "string" || !HEX.test(hex)) return null;
      clean[String(shade)] = hex.toLowerCase();
    }
    result[name] = clean;
  }
  return result as SystemPalettes;
}

/**
 * A tonal palette that returns the phone's 13 colours exactly and makes the other tones from the hue and chroma
 * of the middle shade (tone 50). It is a real `TonalPalette` underneath, only `tone` is overridden.
 */
function tonalPaletteOf(palette: SystemPalette): TonalPalette {
  const exact = new Map<number, number>();
  for (const shade of SHADES) exact.set(shadeToTone(shade), argbFromHex(palette[String(shade)]!));
  const generated = TonalPalette.fromHct(Hct.fromInt(exact.get(50)!));
  return Object.assign(Object.create(generated) as TonalPalette, {
    tone: (tone: number): number => exact.get(tone) ?? generated.tone(tone),
  });
}

/**
 * Light and dark variables from the system palettes, or null when they are incomplete. Same colour roles and
 * tones as the seed path (the library's `Scheme`): primary = accent1, secondary = accent2, tertiary = accent3,
 * background/surface/outline = neutral1/neutral2. Android has no error palette, so the library's red is used.
 */
export function systemThemeVariables(input: unknown): { light: Record<string, string>; dark: Record<string, string> } | null {
  const palettes = parseSystemPalettes(input);
  if (!palettes) return null;
  const core = {
    a1: tonalPaletteOf(palettes.accent1),
    a2: tonalPaletteOf(palettes.accent2),
    a3: tonalPaletteOf(palettes.accent3),
    n1: tonalPaletteOf(palettes.neutral1),
    n2: tonalPaletteOf(palettes.neutral2),
    error: TonalPalette.fromHueAndChroma(25, 84),
  } as CorePalette;
  return {
    light: schemeToCssVariables(Scheme.lightFromCorePalette(core).toJSON() as Record<string, number>),
    dark: schemeToCssVariables(Scheme.darkFromCorePalette(core).toJSON() as Record<string, number>),
  };
}
