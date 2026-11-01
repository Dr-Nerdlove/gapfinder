<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    variant?: "filled" | "tonal" | "text" | "danger";
    type?: "button" | "submit";
    disabled?: boolean;
    href?: string;
    full?: boolean;
    onclick?: (event: MouseEvent) => void;
    children: Snippet;
  }

  let { variant = "filled", type = "button", disabled = false, href, full = false, onclick, children }: Props = $props();
</script>

{#if href && !disabled}
  <a class="button {variant}" class:full {href}>{@render children()}</a>
{:else}
  <button class="button {variant}" class:full {type} {disabled} {onclick}>{@render children()}</button>
{/if}

<style>
  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    min-width: 48px;
    padding: 0 24px;
    border: 0;
    border-radius: var(--radius-button);
    font: inherit;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
  }

  .full {
    width: 100%;
  }

  .filled {
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
  }

  .tonal {
    background: var(--md-sys-color-secondary-container);
    color: var(--md-sys-color-on-secondary-container);
  }

  .text {
    background: transparent;
    color: var(--md-sys-color-primary);
    padding: 0 16px;
  }

  .danger {
    background: var(--md-sys-color-error);
    color: var(--md-sys-color-on-error);
  }

  .button:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .button:disabled {
    cursor: not-allowed;
    opacity: 0.38;
  }
</style>
