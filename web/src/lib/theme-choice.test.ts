import { hexFromArgb, TonalPalette } from "@material/material-color-utilities";
import { describe, expect, it } from "vitest";
import { SHADES, shadeToTone, systemThemeVariables, type SystemPalettes } from "./system-colors";
import { generateThemeVariables } from "./theme";
import {
  createThemeChoice,
  loadSystemPalettes,
  loadUseSystemColors,
  saveSystemPalettes,
  saveUseSystemColors,
  SYSTEM_COLORS_KEY,
} from "./theme-choice";
import { brokenStorage, MemoryStorage } from "./test-storage";

function phone(hue: number, chroma: number): Record<string, string> {
  const palette = TonalPalette.fromHueAndChroma(hue, chroma);
  return Object.fromEntries(SHADES.map((shade) => [String(shade), hexFromArgb(palette.tone(shadeToTone(shade)))]));
}
const PALETTES: SystemPalettes = {
  accent1: phone(150, 48),
  accent2: phone(160, 16),
  accent3: phone(200, 24),
  neutral1: phone(150, 4),
  neutral2: phone(150, 8),
};
const ANSWER = { available: true, palettes: PALETTES };
const SEED = "#2e7d32";
const SEED_PRIMARY = generateThemeVariables(SEED).light["--md-sys-color-primary"];
const SYSTEM_PRIMARY = PALETTES.accent1["600"];

const primary = (c: { variables(): { light: Record<string, string> } }): string | undefined =>
  c.variables().light["--md-sys-color-primary"];

describe("theme choice", () => {
  it("uses the seed colour outside the app, and never asks or stores anything", async () => {
    const storage = new MemoryStorage();
    let asked = 0;
    const choice = createThemeChoice({
      inApp: false,
      seed: SEED,
      storage,
      read: async () => (asked++, ANSWER),
    });
    await choice.refresh();
    expect(asked).toBe(0);
    expect(primary(choice)).toBe(SEED_PRIMARY);
    expect(choice.available()).toBe(false);
    expect(choice.active()).toBe(false);
    expect(storage.getItem(SYSTEM_COLORS_KEY)).toBeNull();
  });

  it("outside the app ignores cached palettes and the switch", () => {
    const storage = new MemoryStorage();
    saveSystemPalettes(PALETTES, storage);
    const choice = createThemeChoice({ inApp: false, seed: SEED, storage });
    expect(primary(choice)).toBe(SEED_PRIMARY);
  });

  it("uses the system colours in the app when available and switched on (the default)", async () => {
    const choice = createThemeChoice({
      inApp: true,
      seed: SEED,
      storage: new MemoryStorage(),
      read: async () => ANSWER,
    });
    expect(primary(choice)).toBe(SEED_PRIMARY); // nothing known yet
    await choice.refresh();
    expect(choice.available()).toBe(true);
    expect(choice.active()).toBe(true);
    expect(primary(choice)).toBe(SYSTEM_PRIMARY);
    expect(choice.variables()).toEqual(systemThemeVariables(PALETTES));
  });

  it("uses the seed colour when the switch is off, and remembers that", async () => {
    const storage = new MemoryStorage();
    const choice = createThemeChoice({
      inApp: true,
      seed: SEED,
      storage,
      read: async () => ANSWER,
    });
    await choice.refresh();
    choice.setEnabled(false);
    expect(choice.active()).toBe(false);
    expect(choice.available()).toBe(true);
    expect(primary(choice)).toBe(SEED_PRIMARY);
    expect(loadUseSystemColors(storage)).toBe(false);
    const again = createThemeChoice({
      inApp: true,
      seed: SEED,
      storage,
      read: async () => ANSWER,
    });
    await again.refresh();
    expect(primary(again)).toBe(SEED_PRIMARY);
    again.setEnabled(true);
    expect(primary(again)).toBe(SYSTEM_PRIMARY);
  });

  it.each([
    ["rejects", async () => Promise.reject(new Error("not implemented"))],
    [
      "throws",
      async () => {
        throw new Error("boom");
      },
    ],
    ["says unavailable", async () => ({ available: false })],
    ["answers nothing", async () => null],
    ["answers an incomplete palette", async () => ({ available: true, palettes: { ...PALETTES, accent3: {} } })],
  ])("falls back to the seed colour, quietly, when the app %s", async (_name, read) => {
    const choice = createThemeChoice({
      inApp: true,
      seed: SEED,
      storage: new MemoryStorage(),
      read,
    });
    await expect(choice.refresh()).resolves.toBeUndefined();
    expect(choice.available()).toBe(false);
    expect(primary(choice)).toBe(SEED_PRIMARY);
  });

  it("applies cached palettes at once, before the app answers", () => {
    const storage = new MemoryStorage();
    saveSystemPalettes(PALETTES, storage);
    const choice = createThemeChoice({
      inApp: true,
      seed: SEED,
      storage,
      read: () => new Promise(() => undefined),
    });
    expect(primary(choice)).toBe(SYSTEM_PRIMARY);
  });

  it("ignores a broken cache", () => {
    const storage = new MemoryStorage();
    storage.setItem(SYSTEM_COLORS_KEY, "{not json");
    expect(loadSystemPalettes(storage)).toBeNull();
    storage.setItem(SYSTEM_COLORS_KEY, JSON.stringify({ accent1: {} }));
    expect(primary(createThemeChoice({ inApp: true, seed: SEED, storage }))).toBe(SEED_PRIMARY);
  });

  it("forgets the cache when the app no longer has system colours", async () => {
    const storage = new MemoryStorage();
    saveSystemPalettes(PALETTES, storage);
    const choice = createThemeChoice({
      inApp: true,
      seed: SEED,
      storage,
      read: async () => ({ available: false }),
    });
    await choice.refresh();
    expect(primary(choice)).toBe(SEED_PRIMARY);
    expect(loadSystemPalettes(storage)).toBeNull();
  });

  it("drops cached palettes when the call is rejected", async () => {
    const storage = new MemoryStorage();
    saveSystemPalettes(PALETTES, storage);
    const choice = createThemeChoice({ inApp: true, seed: SEED, storage, read: async () => Promise.reject(new Error("not implemented")) });
    expect(primary(choice)).toBe(SYSTEM_PRIMARY);
    await choice.refresh();
    expect(primary(choice)).toBe(SEED_PRIMARY);
    expect(loadSystemPalettes(storage)).toBeNull();
  });

  it("stores the answer for the next start", async () => {
    const storage = new MemoryStorage();
    await createThemeChoice({
      inApp: true,
      storage,
      read: async () => ANSWER,
    }).refresh();
    expect(loadSystemPalettes(storage)).toEqual(PALETTES);
  });

  it("applies new palettes on the next read and tells the listeners only when something changed", async () => {
    let answer: unknown = ANSWER;
    const choice = createThemeChoice({
      inApp: true,
      seed: SEED,
      storage: new MemoryStorage(),
      read: async () => answer,
    });
    let calls = 0;
    choice.subscribe(() => calls++);
    await choice.refresh();
    expect(calls).toBe(1);
    await choice.refresh();
    expect(calls).toBe(1);
    answer = {
      available: true,
      palettes: { ...PALETTES, accent1: phone(300, 48) },
    };
    await choice.refresh();
    expect(calls).toBe(2);
    expect(primary(choice)).not.toBe(SYSTEM_PRIMARY);
  });

  it("does not let a new seed colour override active system colours, but uses it as soon as the switch is off", async () => {
    const choice = createThemeChoice({
      inApp: true,
      seed: SEED,
      storage: new MemoryStorage(),
      read: async () => ANSWER,
    });
    await choice.refresh();
    let calls = 0;
    choice.subscribe(() => calls++);
    choice.setSeed("#d32f2f");
    expect(primary(choice)).toBe(SYSTEM_PRIMARY);
    expect(calls).toBe(0);
    choice.setEnabled(false);
    expect(primary(choice)).toBe(generateThemeVariables("#d32f2f").light["--md-sys-color-primary"]);
  });

  it("switches to a new seed colour at once where no system colours are worn", () => {
    const choice = createThemeChoice({
      inApp: false,
      seed: SEED,
      storage: null,
    });
    let calls = 0;
    choice.subscribe(() => calls++);
    choice.setSeed("#d32f2f");
    expect(calls).toBe(1);
    expect(primary(choice)).toBe(generateThemeVariables("#d32f2f").light["--md-sys-color-primary"]);
    choice.setSeed(null);
    expect(primary(choice)).toBe(generateThemeVariables("#6750A4").light["--md-sys-color-primary"]);
  });

  it("works without usable storage", async () => {
    expect(loadUseSystemColors(brokenStorage)).toBe(true);
    expect(loadSystemPalettes(brokenStorage)).toBeNull();
    expect(() => saveUseSystemColors(false, brokenStorage)).not.toThrow();
    expect(() => saveSystemPalettes(PALETTES, brokenStorage)).not.toThrow();
    const choice = createThemeChoice({
      inApp: true,
      seed: SEED,
      storage: brokenStorage,
      read: async () => ANSWER,
    });
    await choice.refresh();
    expect(primary(choice)).toBe(SYSTEM_PRIMARY);
  });
});
