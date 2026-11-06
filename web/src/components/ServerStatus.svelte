<script lang="ts">
  import { onMount } from "svelte";
  import { API_URL } from "../lib/config";
  import { checkHealth, type HealthResult } from "../lib/health";
  import { sessionState } from "../lib/session.svelte";
  import { showSleepCard } from "../lib/sleep-notice";

  let status = $state<HealthResult | { kind: "loading" }>({ kind: "loading" });
  // The start page shows OfflineNotice (the same message) for a logged-in user whose session noticed the server is away.
  const noticeVisible = $derived(sessionState.offline && sessionState.user !== null);

  async function load(): Promise<void> {
    status = { kind: "loading" };
    status = await checkHealth(API_URL);
  }

  onMount(() => {
    void load();
  });
</script>

{#if showSleepCard(status, noticeVisible)}
  <section class="card" aria-live="polite">
    <h2>Lückenfüller schläft gerade</h2>
    <p>Der Server ist nachts von 1 bis 7 Uhr aus. Versuch es später noch einmal.</p>
    <button type="button" onclick={load}>Erneut versuchen</button>
  </section>
{/if}

<style>
  .card {
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

  p {
    margin-top: 4px;
  }

  button {
    margin-top: 16px;
    min-height: 48px;
    padding: 0 24px;
    border: 0;
    border-radius: var(--radius-button);
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
    font-weight: 500;
    cursor: pointer;
  }

  button:hover {
    filter: brightness(1.08);
  }
</style>
