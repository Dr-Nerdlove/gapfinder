import { argbFromHex, hexFromArgb, themeFromSourceColor } from "@material/material-color-utilities";
import { normalizeSeedColor } from "@lueckenfueller/shared";
import type { ThemeChoice } from "./theme-choice";

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

export interface ThemeVariables {
  light: Record<string, string>;
  dark: Record<string, string>;
}

/** Generates the light and dark variables from a seed colour like `#6750A4`. */
export function generateThemeVariables(seed: string): ThemeVariables {
  const theme = themeFromSourceColor(argbFromHex(seed));
  return {
    light: schemeToCssVariables(theme.schemes.light.toJSON() as ColorScheme),
    dark: schemeToCssVariables(theme.schemes.dark.toJSON() as ColorScheme),
  };
}

/** The seed to use: the given `#rrggbb` colour, or the app's default when there is none or it is not valid. */
export function resolveSeed(seed: string | null | undefined): string {
  return (seed ? normalizeSeedColor(seed) : null) ?? SEED_COLOR;
}

export interface ThemeHandle {
  stop(): void;
}

/**
 * Applies the chosen colours to `<html>`, follows the phone's light/dark setting and re-reads the system colours
 * whenever the app becomes visible again (the wallpaper, and so the palette, may have changed meanwhile).
 */
export function startTheme(choice: ThemeChoice): ThemeHandle {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;

  const apply = (): void => {
    const variables = choice.variables();
    const chosen = media.matches ? variables.dark : variables.light;
    for (const [name, value] of Object.entries(chosen)) {
      root.style.setProperty(name, value);
    }
    root.style.colorScheme = media.matches ? "dark" : "light";
  };
  const onVisible = (): void => {
    if (document.visibilityState === "visible") void choice.refresh();
  };

  media.addEventListener("change", apply);
  document.addEventListener("visibilitychange", onVisible);
  const unsubscribe = choice.subscribe(apply);
  apply();
  void choice.refresh();
  return {
    stop() {
      media.removeEventListener("change", apply);
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribe();
    },
  };
}
