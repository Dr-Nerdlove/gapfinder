<script lang="ts">
  import type { BackupStatus, CalendarList } from "@lueckenfueller/shared";
  import * as api from "../lib/api";
  import Button from "../components/Button.svelte";
  import Card from "../components/Card.svelte";
  import MenuItem from "../components/MenuItem.svelte";
  import OfflineNotice from "../components/OfflineNotice.svelte";
  import ServerStatus from "../components/ServerStatus.svelte";
  import Tour from "../components/Tour.svelte";
  import { backupWarnings } from "../lib/backup-status";
  import { brokenCount } from "../lib/calendars";
  import { session, sessionState } from "../lib/session.svelte";
  import { markTourSeen, tourSeen } from "../lib/tour";

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

  let tourOpen = $state(false);

  // The tour opens by itself once per user and device. It counts as seen as soon as it opens, so leaving
  // through a link or closing the tab does not bring it back.
  $effect(() => {
    if (userId !== undefined && !tourSeen(userId)) {
      markTourSeen(userId);
      tourOpen = true;
    }
  });

  const isAdmin = $derived(sessionState.user?.isAdmin === true);

  /**
   * Null until known; stays null for everyone but the admin, when the server is asleep or answers an error (an
   * older server answers 404 until the VM has updated).
   */
  let backupStatus = $state<BackupStatus | null>(null);

  $effect(() => {
    if (!isAdmin) {
      backupStatus = null;
      return;
    }
    let current = true;
    void session.run((o) => api.getBackupStatus(o)).then((result) => {
      if (current) backupStatus = result.ok ? result.data : null;
    });
    return () => {
      current = false;
    };
  });

  const backupProblems = $derived(backupStatus ? backupWarnings(backupStatus, new Date()) : []);

  const broken = $derived(calendarList ? brokenCount(calendarList.calendars) : 0);
</script>

<header>
  <h1>Lückenfüller</h1>
  <p class="subtitle">Nie wieder „Wann hast du Zeit?“</p>
</header>

<div class="stack">
  {#if sessionState.user}
    <Card title="Hallo {sessionState.user.username}">
      <div class="menu-card">
        <Button href="#/suche" full>Lücken suchen</Button>
        <nav aria-label="Menü">
          <ul class="menu">
            <li><MenuItem label="Meine Abstimmungen" href="#/abstimmungen" /></li>
            <li><MenuItem label="Kalender" href="#/kalender" /></li>
            <li><MenuItem label="Profil" href="#/profil" /></li>
            <li><MenuItem label="Einführung" onclick={() => (tourOpen = true)} /></li>
          </ul>
          {#if sessionState.user.isAdmin}
            <p class="admin-label">Nur für Admins</p>
            <ul class="menu">
              <li><MenuItem label="Verwaltung" href="#/verwaltung" /></li>
            </ul>
          {/if}
        </nav>
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
    {#if backupProblems.length > 0}
      <Card title="Sicherung prüfen" tone="notice">
        {#each backupProblems as problem (problem)}
          <p>{problem}</p>
        {/each}
        <div class="actions"><Button href="#/verwaltung">Zur Verwaltung</Button></div>
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

{#if sessionState.user}
  <Tour open={tourOpen} hasCalendar={calendarList ? calendarList.calendars.length > 0 : null} onclose={() => (tourOpen = false)} />
{/if}

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

  .menu-card,
  nav {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .menu {
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: 16px;
    overflow: hidden;
  }

  .menu li + li {
    border-top: 1px solid var(--md-sys-color-outline);
  }

  .admin-label {
    margin: 0 0 -4px;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--md-sys-color-on-surface-variant);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
