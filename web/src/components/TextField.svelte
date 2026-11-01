<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";

  interface Props {
    label: string;
    value?: string;
    type?: "text" | "password";
    autocomplete?: HTMLInputAttributes["autocomplete"];
    hint?: string;
    error?: string;
    disabled?: boolean;
    required?: boolean;
    maxlength?: number;
    name?: string;
  }

  let {
    label,
    value = $bindable(""),
    type = "text",
    autocomplete,
    hint,
    error,
    disabled = false,
    required = false,
    maxlength,
    name,
  }: Props = $props();

  const id = $props.id();
</script>

<div class="field">
  <label for={id}>{label}</label>
  <input
    {id}
    {name}
    {type}
    {autocomplete}
    {disabled}
    {required}
    {maxlength}
    autocapitalize="off"
    spellcheck="false"
    aria-invalid={error ? "true" : undefined}
    aria-describedby={hint || error ? `${id}-note` : undefined}
    bind:value
  />
  {#if error || hint}
    <p id="{id}-note" class="note" class:error={!!error}>{error ?? hint}</p>
  {/if}
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--md-sys-color-on-surface-variant);
  }

  input {
    min-height: 48px;
    padding: 0 16px;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: 12px;
    background: var(--md-sys-color-surface);
    color: var(--md-sys-color-on-surface);
    font: inherit;
  }

  input:disabled {
    opacity: 0.6;
  }

  input[aria-invalid="true"] {
    border-color: var(--md-sys-color-error);
  }

  .note {
    font-size: 0.875rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .note.error {
    color: var(--md-sys-color-error);
  }
</style>
