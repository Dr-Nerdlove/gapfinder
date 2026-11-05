<script lang="ts">
  import type { DoorbellStatus } from "@lueckenfueller/shared";
  import * as api from "../../lib/api";
  import { doorbellDevicesText, doorbellLastRingText, doorbellStateText } from "../../lib/doorbell-status";
  import { session } from "../../lib/session.svelte";
  import Card from "../Card.svelte";

  type Screen = { phase: "loading" } | { phase: "unknown" } | { phase: "failed" } | { phase: "known"; status: DoorbellStatus };
  let screen = $state<Screen>({ phase: "loading" });

  $effect(() => {
    let current = true;
    void session.run((o) => api.getDoorbellStatus(o)).then((result) => {
      if (!current) return;
      if (result.ok) screen = { phase: "known", status: result.data };
      // A server from before the instant ring answers 404 for the route.
      else screen = result.kind === "error" && result.status === 404 ? { phase: "unknown" } : { phase: "failed" };
    });
    return () => {
      current = false;
    };
  });
</script>

{#if screen.phase !== "loading" && screen.phase !== "failed"}
  <Card title="Sofort-Benachrichtigungen (Android)" tone={screen.phase === "known" && screen.status.state === "ready" ? "plain" : "notice"}>
    {#if screen.phase === "unknown"}
      <p>Der Server kennt diese Funktion noch nicht. Sie ist da, sobald er auf die neue Version aktualisiert ist.</p>
    {:else}
      <p>{doorbellStateText(screen.status)}</p>
      <ul>
        <li><strong>Handys</strong><span>{doorbellDevicesText(screen.status.devicesWithToken)}</span></li>
        <li><strong>Letztes Signal</strong><span>{doorbellLastRingText(screen.status.lastRing)}</span></li>
      </ul>
    {/if}
  </Card>
{/if}

<style>
  ul {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-direction: column;
  }

  span {
    font-size: 0.875rem;
  }
</style>
