<script lang="ts">
  import type { Calendar } from "@lueckenfueller/shared";
  import * as api from "../lib/api";
  import CalendarAdd from "../components/calendars/CalendarAdd.svelte";
  import CalendarList from "../components/calendars/CalendarList.svelte";
  import CalendarPreview from "../components/calendars/CalendarPreview.svelte";
  import Button from "../components/Button.svelte";
  import Card from "../components/Card.svelte";
  import Message from "../components/Message.svelte";
  import OfflineNotice from "../components/OfflineNotice.svelte";
  import Page from "../components/Page.svelte";
  import { applyCalendarUpdate } from "../lib/calendars";
  import { errorMessage } from "../lib/messages";
  import { session, sessionState } from "../lib/session.svelte";

  const user = $derived(sessionState.user);
  const locked = $derived(sessionState.offline);

  let calendars = $state<Calendar[]>([]);
  let loading = $state(true);
  let loaded = $state(false);
  let unavailable = $state(false);
  let loadError = $state("");
  /** Raised when the events of the preview may have changed. */
  let previewVersion = $state(0);
  let list = $state<ReturnType<typeof CalendarList>>();

  async function load(silent = false): Promise<void> {
    if (!silent) loading = true;
    loadError = "";
    const result = await session.run((o) => api.listCalendars(o));
    loading = false;
    if (result.ok) {
      calendars = result.data.calendars;
      unavailable = result.data.state === "unavailable";
      loaded = true;
      if (!silent) previewVersion++;
    } else if (result.kind === "error") {
      loadError = errorMessage(result);
    }
    // Offline: the notice explains it; what was loaded before stays.
  }

  $effect(() => {
    if (user) void load();
  });

  const reloadPreview = (): void => void previewVersion++;

  function changed(calendar: Calendar, eventsMayHaveChanged: boolean): void {
    calendars = applyCalendarUpdate(calendars, calendar);
    if (eventsMayHaveChanged) reloadPreview();
  }

  function removed(id: number): void {
    calendars = calendars.filter((c) => c.id !== id);
    reloadPreview();
    // Another calendar may have become the default.
    void load(true);
  }

  function added(calendar: Calendar): void {
    calendars = applyCalendarUpdate(calendars, calendar);
    reloadPreview();
  }
</script>

<Page title="Kalender" subtitle="Damit Lückenfüller weiß, wann du Zeit hast">
  <OfflineNotice onretry={() => load()} />
  {#if !user}
    <!-- Only reached while logging out. -->
  {:else if loadError}
    <Card>
      <Message text={loadError} />
      <div><Button variant="tonal" onclick={() => load()}>Erneut versuchen</Button></div>
    </Card>
  {:else if loading && !loaded}
    <Card><p aria-live="polite">Einen Moment …</p></Card>
  {:else if unavailable}
    <Card tone="notice" title="Kalender sind noch nicht eingerichtet">
      <p>Der Server kann Kalender-Links noch nicht sicher aufbewahren. Der Admin muss die Einrichtung erst abschließen.</p>
      {#if user.isAdmin}
        <p>Du bist Admin: Führe setup.sh in der VM noch einmal aus, siehe Anleitung.</p>
      {/if}
    </Card>
  {:else if loaded}
    {#if calendars.length === 0}
      <Card>
        <p>Du hast noch keinen Kalender verknüpft. Trage unten den Link zu deinem Kalender ein.</p>
      </Card>
    {:else}
      <CalendarList bind:this={list} {calendars} {locked} onchanged={changed} onremoved={removed} />
    {/if}
    <CalendarAdd count={calendars.length} {locked} onadded={added} />
    {#if calendars.length > 0}
      <CalendarPreview {calendars} version={previewVersion} {locked} onrelink={(id) => list?.startRelink(id)} />
    {/if}
  {/if}
</Page>
