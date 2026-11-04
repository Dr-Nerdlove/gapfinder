import { defaultStorage } from "./session-storage";
import { parseSystemPalettes, systemThemeVariables, type SystemPalettes } from "./system-colors";
import { generateThemeVariables, resolveSeed, type ThemeVariables } from "./theme";

// Which colours the app wears: inside the Android app the phone's Material You colours (when the phone has them
// and the per-device switch is on), everywhere else the profile's seed colour. No DOM here, so it can be tested.

export const SYSTEM_COLORS_KEY = "lueckenfueller.system-colors";
export const USE_SYSTEM_COLORS_KEY = "lueckenfueller.use-system-colors";

/** The per-device switch; on unless it was turned off. */
export function loadUseSystemColors(storage: Storage | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(USE_SYSTEM_COLORS_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveUseSystemColors(on: boolean, storage: Storage | null = defaultStorage()): void {
  try {
    storage?.setItem(USE_SYSTEM_COLORS_KEY, on ? "1" : "0");
  } catch {
    // Nothing to do: the choice then lasts until the page is closed.
  }
}

/** The palettes of the last start, so the right colours show before the app has answered. */
export function loadSystemPalettes(storage: Storage | null = defaultStorage()): SystemPalettes | null {
  try {
    const raw = storage?.getItem(SYSTEM_COLORS_KEY);
    return raw ? parseSystemPalettes(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Remembers the palettes; `null` forgets them. */
export function saveSystemPalettes(palettes: SystemPalettes | null, storage: Storage | null = defaultStorage()): void {
  try {
    if (palettes === null) storage?.removeItem(SYSTEM_COLORS_KEY);
    else storage?.setItem(SYSTEM_COLORS_KEY, JSON.stringify(palettes));
  } catch {
    // Nothing to do.
  }
}

export interface ThemeChoiceOptions {
  /** True only inside the Android app. Outside, the seed colour always applies and nothing is read or stored. */
  inApp: boolean;
  /** Asks the app for the system colours (the plugin's `systemColors`). May reject, e.g. in an older app shell. */
  read?: () => Promise<unknown>;
  storage?: Storage | null;
  seed?: string | null;
}

export interface ThemeChoice {
  /** The variables to apply now. */
  variables(): ThemeVariables;
  /** Is the phone offering system colours (so the profile may show the switch)? */
  available(): boolean;
  /** The per-device switch. */
  enabled(): boolean;
  /** Are the system colours being worn right now? */
  active(): boolean;
  setSeed(seed: string | null | undefined): void;
  setEnabled(on: boolean): void;
  /** Asks the app again; a failure means "no system colours". Resolves when the answer is applied. */
  refresh(): Promise<void>;
  /** Called after every change of the variables or the state. Returns the function that stops it. */
  subscribe(listener: () => void): () => void;
}

export function createThemeChoice(options: ThemeChoiceOptions): ThemeChoice {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const inApp = options.inApp;
  let seed = resolveSeed(options.seed);
  let on = inApp ? loadUseSystemColors(storage) : true;
  let palettes: SystemPalettes | null = inApp ? loadSystemPalettes(storage) : null;
  const listeners = new Set<() => void>();

  const isActive = (): boolean => inApp && on && palettes !== null;
  let seedVariables: ThemeVariables | null = null;
  let systemVariables: ThemeVariables | null = null;
  const compute = (): ThemeVariables => {
    if (isActive()) {
      systemVariables ??= systemThemeVariables(palettes);
      if (systemVariables) return systemVariables;
    }
    seedVariables ??= generateThemeVariables(seed);
    return seedVariables;
  };
  const changed = (): void => {
    for (const listener of [...listeners]) listener();
  };

  return {
    variables: compute,
    available: () => inApp && palettes !== null,
    enabled: () => on,
    active: isActive,
    setSeed(next) {
      const resolved = resolveSeed(next);
      if (resolved === seed) return;
      seed = resolved;
      seedVariables = null;
      if (!isActive()) changed(); // system colours stay, the seed waits for the switch
    },
    setEnabled(next) {
      if (next === on) return;
      on = next;
      saveUseSystemColors(on, storage);
      changed();
    },
    async refresh() {
      if (!inApp || !options.read) return;
      let fresh: SystemPalettes | null = null;
      try {
        const answer = (await options.read()) as {
          available?: unknown;
          palettes?: unknown;
        } | null;
        fresh = answer && answer.available === true ? parseSystemPalettes(answer.palettes) : null;
      } catch {
        fresh = null; // older app shell or a failure: simply no system colours
      }
      if (JSON.stringify(fresh) === JSON.stringify(palettes)) return;
      palettes = fresh;
      systemVariables = null;
      saveSystemPalettes(fresh, storage);
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
