<script lang="ts">
  import { onMount } from "svelte";
  import * as api from "../lib/api";
  import { FEED_UNAVAILABLE_TEXT, feedScreenOf, type FeedScreen } from "../lib/calendar-feed";
  import { buildFeedLink } from "../lib/links";
  import { errorMessage } from "../lib/messages";
  import { session, sessionState } from "../lib/session.svelte";
  import Button from "./Button.svelte";
  import Card from "./Card.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import LinkBox from "./LinkBox.svelte";
  import Message from "./Message.svelte";

  const locked = $derived(sessionState.offline);
  let screen = $state<FeedScreen>({ phase: "loading" });
  let busy = $state(false);
  let problem = $state("");
  let confirming = $state<"renew" | "off" | null>(null);

  async function load(): Promise<void> {
    const result = await session.run((o) => api.getCalendarFeed(o));
    screen = feedScreenOf(result);
  }

  onMount(() => void load());

  /** Switches on or renews the feed: both are the same call; the answer holds the new token. */
  async function turnOn(): Promise<void> {
    if (busy) return;
    busy = true;
    problem = "";
    const result = await session.run((o) => api.createCalendarFeed(o));
    busy = false;
    if (result.ok) screen = feedScreenOf(result);
    else problem = errorMessage(result);
  }

  async function turnOff(): Promise<void> {
    if (busy) return;
    busy = true;
    problem = "";
    const result = await session.run((o) => api.deleteCalendarFeed(o));
    busy = false;
    if (result.ok) screen = { phase: "off" };
    else problem = errorMessage(result);
  }

  function confirm(): void {
    const what = confirming;
    confirming = null;
    if (what === "renew") void turnOn();
    if (what === "off") void turnOff();
  }
</script>

<!-- Asleep and OfflineNotice already says so: the card stays away instead of repeating it. -->
{#if !(screen.phase === "waiting" && sessionState.offline)}
<Card title="Mein Lückenfüller-Kalender">
  {#if screen.phase === "loading"}
    <p aria-live="polite">Einen Moment …</p>
  {:else if screen.phase === "waiting"}
    <p>Der Server schläft gerade (nachts von 1 bis 7 Uhr). Komm später wieder.</p>
  {:else if screen.phase === "unavailable"}
    <p>{FEED_UNAVAILABLE_TEXT}</p>
  {:else if screen.phase === "failed"}
    <Message text={screen.message} />
    <div><Button variant="tonal" onclick={load}>Erneut versuchen</Button></div>
  {:else}
    <p class="note">
      Festgelegte Termine erscheinen dann von selbst in deiner Kalender-App. Du richtest das nur einmal ein. Termine, bei denen du „Nein“
      gesagt hast, fehlen.
    </p>
    {#if screen.phase === "off"}
      <div><Button disabled={busy || locked} onclick={turnOn}>Einschalten</Button></div>
    {:else}
      <LinkBox
        label="Dein Kalender-Link"
        link={buildFeedLink(screen.token)}
        note="Nur für dich. Wer den Link hat, sieht deine festgelegten Termine – gib ihn nicht weiter."
        shareText=""
        shareable={false}
      />
      <div class="actions">
        <Button variant="tonal" disabled={busy || locked} onclick={() => (confirming = "renew")}>Neuer Link</Button>
        <Button variant="outlined" disabled={busy || locked} onclick={() => (confirming = "off")}>Abschalten</Button>
      </div>
      <div class="howto">
        <details>
          <summary>Google Kalender</summary>
          <p>
            Am Computer: In Google Kalender links bei „Weitere Kalender“ auf + tippen, „Per URL“ wählen, den Link einfügen und „Kalender
            hinzufügen“. In der Google-Kalender-App auf dem Handy geht das Hinzufügen nicht, der Kalender erscheint dort aber, sobald er
            am Computer hinzugefügt ist.
          </p>
          <p>
            <strong>Wichtig:</strong> Google aktualisiert abonnierte Kalender nur alle paar Stunden, manchmal nur einmal am Tag. Ein neu
            festgelegter Termin kann also verspätet erscheinen.
          </p>
        </details>
        <details>
          <summary>Apple Kalender (iPhone, iPad, Mac)</summary>
          <p>
            iPhone und iPad: Einstellungen → Kalender → Accounts → Account hinzufügen → Andere → Kalenderabo hinzufügen, dann den Link
            einfügen (je nach iOS-Version heißt der Weg ein wenig anders). Mac: Kalender-App → Ablage → Neues Kalenderabonnement.
          </p>
        </details>
        <details>
          <summary>Outlook</summary>
          <p>Outlook im Browser: Kalender → Kalender hinzufügen → Aus dem Internet abonnieren, dann den Link einfügen.</p>
        </details>
      </div>
    {/if}
    <Message text={problem} />
  {/if}
</Card>
{/if}

<ConfirmDialog
  open={confirming === "renew"}
  title="Neuen Link erzeugen?"
  text="Der alte Link funktioniert danach nicht mehr. Du musst den neuen Link in deiner Kalender-App noch einmal eintragen."
  confirmLabel="Neuer Link"
  {busy}
  onconfirm={confirm}
  oncancel={() => (confirming = null)}
/>
<ConfirmDialog
  open={confirming === "off"}
  title="Kalender abschalten?"
  text="Der Link funktioniert danach nicht mehr, und deine Kalender-App zeigt keine neuen Termine mehr. Du kannst ihn später wieder einschalten, bekommst dann aber einen neuen Link."
  confirmLabel="Abschalten"
  {busy}
  onconfirm={confirm}
  oncancel={() => (confirming = null)}
/>

<style>
  .note {
    font-size: 0.875rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .howto {
    display: flex;
    flex-direction: column;
  }

  details {
    padding: 8px 0;
    border-top: 1px solid var(--md-sys-color-outline-variant);
  }

  summary {
    min-height: 32px;
    font-weight: 600;
    cursor: pointer;
  }

  details p {
    margin-top: 8px;
    font-size: 0.9375rem;
  }
</style>
