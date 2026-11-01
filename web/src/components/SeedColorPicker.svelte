<script lang="ts">
  import { normalizeSeedColor } from "@lueckenfueller/shared";
  import { SEED_COLOR } from "../lib/theme";
  import { SEED_PRESETS } from "../lib/seed-presets";
  import Button from "./Button.svelte";

  interface Props {
    /** The saved seed colour (`#rrggbb`) or null for the default. */
    value: string | null;
    disabled?: boolean;
    onpick: (seed: string | null) => void;
  }

  let { value, disabled = false, onpick }: Props = $props();
  const isPreset = $derived(SEED_PRESETS.some((preset) => preset.hex === value));
  const customValue = $derived(value ?? SEED_COLOR.toLowerCase());
</script>

<div class="picker">
  <div class="swatches" role="group" aria-label="Farbe wählen">
    {#each SEED_PRESETS as preset (preset.hex)}
      <button
        type="button"
        class="swatch"
        style:--swatch={preset.hex}
        aria-label={preset.name}
        aria-pressed={value === preset.hex}
        {disabled}
        onclick={() => onpick(preset.hex)}
      >
        {#if value === preset.hex}<span aria-hidden="true">✓</span>{/if}
      </button>
    {/each}
  </div>
  <div class="more">
    <label class="custom" class:selected={value !== null && !isPreset}>
      <span>Eigene Farbe</span>
      <input
        type="color"
        {disabled}
        value={customValue}
        onchange={(e) => {
          const picked = normalizeSeedColor(e.currentTarget.value);
          if (picked) onpick(picked);
        }}
      />
    </label>
    <Button variant="text" disabled={disabled || value === null} onclick={() => onpick(null)}>Standardfarbe</Button>
  </div>
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .swatch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 50%;
    background: var(--swatch);
    color: #fff;
    font-size: 1.25rem;
    font-weight: 700;
    cursor: pointer;
  }

  .swatch[aria-pressed="true"] {
    border-color: var(--md-sys-color-on-surface);
  }

  .swatch:disabled {
    opacity: 0.38;
    cursor: not-allowed;
  }

  .more {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .custom {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 500;
  }

  .custom.selected span {
    text-decoration: underline;
  }

  input[type="color"] {
    width: 48px;
    height: 48px;
    padding: 0;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
  }
</style>
