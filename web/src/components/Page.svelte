<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    subtitle?: string;
    /** Show a link back to the start page. */
    back?: boolean;
    children: Snippet;
  }

  let { title, subtitle, back = true, children }: Props = $props();
</script>

<header>
  {#if back}<a class="back" href="#/">← Start</a>{/if}
  <h1>{title}</h1>
  {#if subtitle}<p class="subtitle">{subtitle}</p>{/if}
</header>

<div class="content">
  {@render children()}
</div>

<style>
  header {
    padding: 24px 0;
  }

  .back {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    color: var(--md-sys-color-primary);
    font-weight: 500;
  }

  h1 {
    font-size: 1.75rem;
    line-height: 1.2;
    font-weight: 600;
    color: var(--md-sys-color-primary);
  }

  .subtitle {
    margin-top: 4px;
    font-size: 1.125rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-bottom: 32px;
  }
</style>
