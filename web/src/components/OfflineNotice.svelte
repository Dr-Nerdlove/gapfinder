<script lang="ts">
  import { session, sessionState } from "../lib/session.svelte";
  import Button from "./Button.svelte";

  interface Props {
    /** Called once the server is reachable again, e.g. to reload the data of the page. */
    onretry?: () => void;
  }

  let { onretry }: Props = $props();
  let checking = $state(false);

  async function retry(): Promise<void> {
    checking = true;
    const back = await session.checkConnection();
    checking = false;
    if (back) onretry?.();
  }
</script>

{#if sessionState.offline}
  <section class="notice" aria-live="polite">
    <h2>Lückenfüller schläft gerade</h2>
    <p>Der Server ist nachts von 1 bis 7 Uhr aus. Du siehst den letzten Stand, ändern geht erst wieder, wenn er wach ist.</p>
    <Button disabled={checking} onclick={retry}>Erneut versuchen</Button>
  </section>
{/if}

<style>
  .notice {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 20px 24px;
    border-radius: var(--radius-card);
    background: var(--md-sys-color-secondary-container);
    color: var(--md-sys-color-on-secondary-container);
  }

  h2 {
    font-size: 1.25rem;
    line-height: 1.4;
    font-weight: 600;
  }

  .notice :global(.button) {
    margin-top: 8px;
  }
</style>
