<script lang="ts">
  import { CALENDAR_LARGE_BYTES, CALENDARS_LARGE_TOTAL_BYTES, type CalendarSizes } from "@lueckenfueller/shared";
  import * as api from "../../lib/api";
  import { formatCalendarSize } from "../../lib/calendar-size";
  import { session } from "../../lib/session.svelte";
  import Card from "../Card.svelte";

  type Screen = { phase: "loading" } | { phase: "unknown" } | { phase: "failed" } | { phase: "known"; sizes: CalendarSizes };
  let screen = $state<Screen>({ phase: "loading" });

  $effect(() => {
    let current = true;
    void session.run((o) => api.getCalendarSizes(o)).then((result) => {
      if (!current) return;
      if (result.ok) screen = { phase: "known", sizes: result.data };
      // A server from before the size check answers 404 for the route.
      else screen = result.kind === "error" && result.status === 404 ? { phase: "unknown" } : { phase: "failed" };
    });
    return () => {
      current = false;
    };
  });

  const mb = (bytes: number): string => formatCalendarSize(bytes);
  const limitText = `${CALENDARS_LARGE_TOTAL_BYTES / (1024 * 1024)} MB`;
  const largeText = `${CALENDAR_LARGE_BYTES / (1024 * 1024)} MB`;
</script>

{#if screen.phase !== "loading" && screen.phase !== "failed"}
  <Card
    title="Kalendergröße"
    tone={screen.phase === "known" && (screen.sizes.totalBytes > CALENDARS_LARGE_TOTAL_BYTES || screen.sizes.largeCalendarOwners.length > 0) ? "notice" : "plain"}
  >
    {#if screen.phase === "unknown"}
      <p>Der Server kennt diese Funktion noch nicht. Sie ist da, sobald er auf die neue Version aktualisiert ist.</p>
    {:else}
      <p>Alle Kalender zusammen: {mb(screen.sizes.totalBytes)} (Warnung ab {limitText})</p>
      {#if screen.sizes.largeCalendarOwners.length === 0}
        <p>Kein Kalender ist größer als {largeText}.</p>
      {:else}
        <p>Sehr große Kalender (über {largeText}) bei: {screen.sizes.largeCalendarOwners.join(", ")}</p>
      {/if}
    {/if}
  </Card>
{/if}
