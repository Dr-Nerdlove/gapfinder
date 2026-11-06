<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    variant?: "filled" | "tonal" | "outlined" | "danger";
    type?: "button" | "submit";
    disabled?: boolean;
    href?: string;
    /** The link opens in a new tab (for other websites). */
    external?: boolean;
    full?: boolean;
    /** Narrower padding, for rows of several buttons. */
    compact?: boolean;
    onclick?: (event: MouseEvent) => void;
    children: Snippet;
  }

  let { variant = "filled", type = "button", disabled = false, href, external = false, full = false, compact = false, onclick, children }: Props = $props();
</script>

{#if href && !disabled}
  <a class="button {variant}" class:full class:compact {href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>{@render children()}</a>
{:else}
  <button class="button {variant}" class:full class:compact {type} {disabled} {onclick}>{@render children()}</button>
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
    border: 1px solid var(--md-sys-color-outline);
  }

  .outlined {
    background: transparent;
    color: var(--md-sys-color-primary);
    border: 1px solid var(--md-sys-color-outline);
  }

  .compact {
    padding: 0 10px;
    font-size: 0.875rem;
    white-space: nowrap;
  }

  .danger {
    background: var(--md-sys-color-error);
    color: var(--md-sys-color-on-error);
  }

  .button:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .outlined:hover:not(:disabled) {
    filter: none;
    background: color-mix(in srgb, var(--md-sys-color-primary) 8%, transparent);
  }

  .button:disabled {
    cursor: not-allowed;
    opacity: 0.38;
  }
</style>
