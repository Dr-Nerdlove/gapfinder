import { normalizeSeedColor } from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";
import { SEED_PRESETS } from "./seed-presets";

describe("seed presets", () => {
  it("are valid lower-case colours the server accepts", () => {
    for (const preset of SEED_PRESETS) expect(normalizeSeedColor(preset.hex)).toBe(preset.hex);
  });

  it("have unique names and colours", () => {
    expect(new Set(SEED_PRESETS.map((p) => p.name)).size).toBe(SEED_PRESETS.length);
    expect(new Set(SEED_PRESETS.map((p) => p.hex)).size).toBe(SEED_PRESETS.length);
  });
});
