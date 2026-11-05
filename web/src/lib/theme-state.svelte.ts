import type { ThemeChoice } from "./theme-choice";

/** Reactive view of the colour choice for the profile page. */
export const systemColorState = $state({ available: false, enabled: true });

let choice: ThemeChoice | undefined;

/** Called once at startup with the choice that the theme uses. */
export function watchThemeChoice(next: ThemeChoice): void {
  choice = next;
  const sync = (): void => {
    systemColorState.available = next.available();
    systemColorState.enabled = next.enabled();
  };
  next.subscribe(sync);
  sync();
}

/** The per-device switch "Farben vom Handy übernehmen". */
export function setSystemColorsEnabled(on: boolean): void {
  choice?.setEnabled(on);
}
