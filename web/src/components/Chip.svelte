<script lang="ts">
  interface Props {
    label: string;
    selected: boolean;
    disabled?: boolean;
    onclick: () => void;
  }

  let { label, selected, disabled = false, onclick }: Props = $props();
</script>

<button type="button" class="chip" class:selected aria-pressed={selected} {disabled} {onclick}>{label}</button>

<style>
  .chip {
    min-height: 48px;
    min-width: 48px;
    padding: 0 16px;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: 12px;
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    font: inherit;
    cursor: pointer;
  }

  .chip.selected {
    border-color: transparent;
    background: var(--md-sys-color-secondary-container);
    color: var(--md-sys-color-on-secondary-container);
    font-weight: 600;
  }

  .chip:disabled {
    cursor: not-allowed;
    opacity: 0.38;
  }
</style>
