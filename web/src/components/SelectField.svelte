<script lang="ts">
  import type { HelpTopic } from "../lib/help-texts";
  import HelpHint from "./HelpHint.svelte";

  interface Props {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    disabled?: boolean;
    hint?: string;
    help?: HelpTopic;
    onchange?: () => void;
  }

  let { label, value = $bindable(), options, disabled = false, hint, help, onchange }: Props = $props();

  const id = $props.id();
</script>

<div class="field">
  <div class="head"><label for={id}>{label}</label>{#if help}<HelpHint topic={help} />{/if}</div>
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

  .head {
    display: flex;
    align-items: center;
    margin-block: auto;
  }

  label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--md-sys-color-on-surface-variant);
  }

  select {
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
