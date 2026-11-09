<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HelpTopic } from "../lib/help-texts";
  import HelpHint from "./HelpHint.svelte";

  interface Props {
    title?: string;
    /** A "?" button after the title that explains the feature. */
    help?: HelpTopic;
    tone?: "plain" | "notice";
    children: Snippet;
  }

  let { title, help, tone = "plain", children }: Props = $props();
</script>

<section class="card" class:notice={tone === "notice"}>
  {#if title}<h2>{title}{#if help} <HelpHint topic={help} />{/if}</h2>{/if}
  {@render children()}
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px 24px;
    border-radius: var(--radius-card);
    background: var(--md-sys-color-surface-variant);
    color: var(--md-sys-color-on-surface-variant);
  }

  .card.notice {
    background: var(--md-sys-color-secondary-container);
    color: var(--md-sys-color-on-secondary-container);
  }

  h2 {
    font-size: 1.25rem;
    line-height: 1.4;
    font-weight: 600;
  }

  /* Fields inside a card sit on the card's colour, so they get the plain surface as background. */
</style>
