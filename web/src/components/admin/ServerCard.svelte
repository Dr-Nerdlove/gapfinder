<script lang="ts">
  import { API_URL, APP_BUILD, APP_RELEASE } from "../../lib/config";
  import { checkHealth, serverFreshness, type HealthResult } from "../../lib/health";
  import Card from "../Card.svelte";

  let status = $state<HealthResult | null>(null);

  $effect(() => {
    let current = true;
    void checkHealth(API_URL).then((result) => {
      if (current) status = result;
    });
    return () => {
      current = false;
    };
  });

  const freshness = $derived(status?.kind === "online" ? serverFreshness(status.version, APP_BUILD) : "unknown");
</script>

<Card title="Server" tone={status?.kind === "offline" ? "notice" : "plain"}>
  {#if status === null}
    <p aria-live="polite">Einen Moment …</p>
  {:else if status.kind === "online"}
    <p>Der Server ist erreichbar.</p>
    {#if freshness === "current"}
      <p>Der Server ist auf dem neuesten Stand.</p>
    {:else if freshness === "updating"}
      <p>Der Server wird gerade aktualisiert. Das dauert nach einer Änderung bis zu einer Stunde.</p>
    {/if}
    <ul>
      <li>App-Version {APP_RELEASE}</li>
      <li>App-Stand {APP_BUILD}</li>
      <li>Server-Stand {status.version}</li>
    </ul>
  {:else}
    <p>Der Server ist nicht erreichbar.</p>
    <ul>
      <li>App-Version {APP_RELEASE}</li>
      <li>App-Stand {APP_BUILD}</li>
    </ul>
  {/if}
</Card>

<style>
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.8125rem;
    opacity: 0.75;
  }
</style>
