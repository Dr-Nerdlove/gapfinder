<script lang="ts">
  interface Props {
    label: string;
    href?: string;
    onclick?: (event: MouseEvent) => void;
  }

  let { label, href, onclick }: Props = $props();
</script>

{#if href}
  <a class="item" {href}>
    <span>{label}</span>
    {@render chevron()}
  </a>
{:else}
  <button class="item" type="button" {onclick}>
    <span>{label}</span>
    {@render chevron()}
  </button>
{/if}

{#snippet chevron()}
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z" />
  </svg>
{/snippet}

<style>
  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-height: 56px;
    padding: 0 16px;
    margin: 0;
    border: 0;
    background: transparent;
    color: var(--md-sys-color-on-surface);
    font: inherit;
    font-weight: 500;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }

  .item:hover {
    background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
  }

  /* The list box clips its content, so the focus ring sits inside the row. */
  .item:focus-visible {
    outline-offset: -3px;
  }

  svg {
    flex: none;
  }
</style>
