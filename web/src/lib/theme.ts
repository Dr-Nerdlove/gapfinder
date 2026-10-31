import { argbFromHex, hexFromArgb, themeFromSourceColor } from "@material/material-color-utilities";

export const SEED_COLOR = "#6750A4";

type ColorScheme = Record<string, number>;

/** `onPrimaryContainer` -> `--md-sys-color-on-primary-container` */
export function cssVariableName(key: string): string {
  return `--md-sys-color-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/** Turns a Material colour scheme (ARGB numbers) into CSS custom properties with hex values. */
export function schemeToCssVariables(scheme: ColorScheme): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [key, argb] of Object.entries(scheme)) {
    variables[cssVariableName(key)] = hexFromArgb(argb);
  }
  return variables;
}

/** Generates the light and dark variables from a seed colour like `#6750A4`. */
export function generateThemeVariables(seed: string): { light: Record<string, string>; dark: Record<string, string> } {
  const theme = themeFromSourceColor(argbFromHex(seed));
  return {
    light: schemeToCssVariables(theme.schemes.light.toJSON() as ColorScheme),
    dark: schemeToCssVariables(theme.schemes.dark.toJSON() as ColorScheme),
  };
}

/** Applies the colours to `<html>` and follows the phone's light/dark setting. Returns a function that stops it. */
export function startTheme(seed: string = SEED_COLOR): () => void {
  const variables = generateThemeVariables(seed);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;

  const apply = (): void => {
    const chosen = media.matches ? variables.dark : variables.light;
    for (const [name, value] of Object.entries(chosen)) {
      root.style.setProperty(name, value);
    }
    root.style.colorScheme = media.matches ? "dark" : "light";
  };

  media.addEventListener("change", apply);
  apply();
  return () => media.removeEventListener("change", apply);
}
