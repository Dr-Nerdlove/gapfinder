<script lang="ts">
  import Button from "../components/Button.svelte";
  import Card from "../components/Card.svelte";
  import OfflineNotice from "../components/OfflineNotice.svelte";
  import ServerStatus from "../components/ServerStatus.svelte";
  import { sessionState } from "../lib/session.svelte";
</script>

<header>
  <h1>Lückenfüller</h1>
  <p class="subtitle">Gemeinsame freie Zeit finden</p>
</header>

<div class="stack">
  {#if sessionState.user}
    <Card title="Hallo {sessionState.user.username}">
      <div class="actions">
        <Button variant="tonal" href="#/profil">Profil</Button>
        {#if sessionState.user.isAdmin}
          <Button variant="tonal" href="#/verwaltung">Verwaltung</Button>
        {/if}
      </div>
    </Card>
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
