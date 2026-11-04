<script lang="ts">
  interface Props {
    label: string;
    selected: boolean;
    disabled?: boolean;
    onclick: () => void;
  }

  let { label, selected, disabled = false, onclick }: Props = $props();
</script>

<button type="button" class="chip" class:selected aria-pressed={selected} {disabled} {onclick}>
  {#if selected}
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
    </svg>
  {/if}
  {label}
</button>

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
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .chip.selected {
    border-color: var(--md-sys-color-primary);
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
    font-weight: 600;
  }

  .chip:disabled {
    cursor: not-allowed;
    opacity: 0.38;
  }
</style>
