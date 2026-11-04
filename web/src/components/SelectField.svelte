<script lang="ts">
  interface Props {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    disabled?: boolean;
    hint?: string;
    onchange?: () => void;
  }

  let { label, value = $bindable(), options, disabled = false, hint, onchange }: Props = $props();

  const id = $props.id();
</script>

<div class="field">
  <label for={id}>{label}</label>
  <select {id} {disabled} bind:value {onchange} aria-describedby={hint ? `${id}-note` : undefined}>
    {#each options as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
  {#if hint}<p id="{id}-note" class="note">{hint}</p>{/if}
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1 1 8rem;
  }

  label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--md-sys-color-on-surface-variant);
  }

  select {
    margin-top: auto;
    min-height: 48px;
    padding: 0 12px;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: 12px;
    background: var(--md-sys-color-surface);
    color: var(--md-sys-color-on-surface);
    font: inherit;
  }

  select:disabled {
    opacity: 0.6;
  }

  .note {
    font-size: 0.875rem;
    color: var(--md-sys-color-on-surface-variant);
  }
</style>
