<script lang="ts">
  import { onMount } from "svelte";
  import { API_URL, APP_BUILD, APP_RELEASE } from "../lib/config";
  import { checkHealth, serverFreshness, type HealthResult } from "../lib/health";

  let status = $state<HealthResult | { kind: "loading" }>({ kind: "loading" });

  async function load(): Promise<void> {
    status = { kind: "loading" };
    status = await checkHealth(API_URL);
  }

  onMount(() => {
    void load();
  });
</script>

<section class="card" class:sleeping={status.kind === "offline"} aria-live="polite">
  {#if status.kind === "loading"}
    <h2>Verbinde …</h2>
  {:else if status.kind === "online"}
    <h2>Server erreichbar</h2>
    <p>Version {APP_RELEASE}</p>
    {#if serverFreshness(status.version, APP_BUILD) === "current"}
      <p class="detail">Der Server ist auf dem neuesten Stand.</p>
    {:else if serverFreshness(status.version, APP_BUILD) === "updating"}
      <p class="detail">Der Server wird gerade aktualisiert. Das dauert nach einer Änderung bis zu einer Stunde.</p>
    {/if}
    <p class="build">Stand {status.version}</p>
  {:else}
    <h2>Lückenfüller schläft gerade</h2>
    <p>Der Server ist nachts von 1 bis 7 Uhr aus. Versuch es später noch einmal.</p>
    <button type="button" onclick={load}>Erneut versuchen</button>
  {/if}
</section>

<style>
  .card {
    padding: 20px 24px;
    border-radius: var(--radius-card);
    background: var(--md-sys-color-surface-variant);
    color: var(--md-sys-color-on-surface-variant);
  }

  .card.sleeping {
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

  .build {
    font-size: 0.8125rem;
    opacity: 0.75;
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
