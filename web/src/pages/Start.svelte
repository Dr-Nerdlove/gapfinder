<script lang="ts">
  import type { CalendarList } from "@lueckenfueller/shared";
  import * as api from "../lib/api";
  import Button from "../components/Button.svelte";
  import Card from "../components/Card.svelte";
  import OfflineNotice from "../components/OfflineNotice.svelte";
  import ServerStatus from "../components/ServerStatus.svelte";
  import { brokenCount } from "../lib/calendars";
  import { session, sessionState } from "../lib/session.svelte";

  const userId = $derived(sessionState.user?.id);

  /** Null until known; stays null when the server is asleep, calendars are not set up or the server is older. */
  let calendarList = $state<CalendarList | null>(null);

  $effect(() => {
    if (userId === undefined) {
      calendarList = null;
      return;
    }
    let current = true;
    void session.run((o) => api.listCalendars(o)).then((result) => {
      if (current) calendarList = result.ok && result.data.state === "ready" ? result.data : null;
    });
    return () => {
      current = false;
    };
  });

  const broken = $derived(calendarList ? brokenCount(calendarList.calendars) : 0);
</script>

<header>
  <h1>Lückenfüller</h1>
  <p class="subtitle">Gemeinsame freie Zeit finden</p>
</header>

<div class="stack">
  {#if sessionState.user}
    <Card title="Hallo {sessionState.user.username}">
      <div class="actions">
        <Button variant="tonal" href="#/kalender">Kalender</Button>
        <Button variant="tonal" href="#/profil">Profil</Button>
        {#if sessionState.user.isAdmin}
          <Button variant="tonal" href="#/verwaltung">Verwaltung</Button>
        {/if}
      </div>
    </Card>
    {#if calendarList && calendarList.calendars.length === 0}
      <Card tone="notice">
        <p>Verknüpfe deinen Kalender, damit Lückenfüller weiß, wann du Zeit hast.</p>
        <div class="actions"><Button href="#/kalender">Kalender verknüpfen</Button></div>
      </Card>
    {:else if broken > 0}
      <Card tone="notice">
        <p>{broken === 1 ? "Ein Kalender-Link funktioniert nicht mehr." : `${broken} Kalender-Links funktionieren nicht mehr.`}</p>
        <div class="actions"><Button href="#/kalender">Link neu eintragen</Button></div>
      </Card>
    {/if}
    <OfflineNotice />
  {:else}
    <Card>
      <p>Konten gibt es nur auf Einladung. Den Einladungslink bekommst du vom Admin.</p>
      <div class="actions">
        <Button href="#/anmelden">Anmelden</Button>
      </div>
    </Card>
  {/if}

  <ServerStatus />
</div>

<style>
  header {
    padding: 48px 0 24px;
  }

  h1 {
    font-size: 2.25rem;
    line-height: 1.2;
    font-weight: 600;
    color: var(--md-sys-color-primary);
  }

  .subtitle {
    margin-top: 4px;
    font-size: 1.125rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
