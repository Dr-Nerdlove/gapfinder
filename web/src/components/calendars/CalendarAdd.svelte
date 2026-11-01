<script lang="ts">
  import type { Calendar } from "@lueckenfueller/shared";
  import { CALENDAR_NAME_MAX_LENGTH, CALENDAR_LINK_MAX_LENGTH, CALENDARS_PER_USER } from "@lueckenfueller/shared";
  import * as api from "../../lib/api";
  import { calendarDisplayName, canAddCalendar, looksLikeCalendarLink } from "../../lib/calendars";
  import { ERROR_MESSAGES, errorMessage } from "../../lib/messages";
  import { session } from "../../lib/session.svelte";
  import Button from "../Button.svelte";
  import Card from "../Card.svelte";
  import Message from "../Message.svelte";
  import TextField from "../TextField.svelte";

  interface Props {
    count: number;
    locked: boolean;
    onadded: (calendar: Calendar) => void;
  }

  let { count, locked, onadded }: Props = $props();

  let link = $state("");
  let name = $state("");
  let busy = $state(false);
  let linkError = $state("");
  let formError = $state("");
  let done = $state("");

  const disabled = $derived(busy || locked);

  async function add(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    linkError = formError = done = "";
    if (!looksLikeCalendarLink(link)) {
      linkError = ERROR_MESSAGES.calendar_link_invalid;
      return;
    }
    const trimmedName = name.trim();
    busy = true;
    const result = await session.run((o) =>
      api.addCalendar(trimmedName === "" ? { link: link.trim() } : { link: link.trim(), name: trimmedName }, o),
    );
    busy = false;
    if (result.ok) {
      link = name = "";
      done = `„${calendarDisplayName(result.data)}“ ist verknüpft.`;
      onadded(result.data);
    } else if (result.kind === "error" && result.code === "validation" && result.field === "link") {
      linkError = errorMessage(result);
    } else if (result.kind === "error" && result.code.startsWith("calendar_") && result.code !== "calendar_limit") {
      // These all say something about the link.
      linkError = errorMessage(result);
    } else {
      formError = errorMessage(result);
    }
  }
</script>

<Card title="Kalender verknüpfen">
  {#if !canAddCalendar(count)}
    <p>Du hast schon {CALENDARS_PER_USER} Kalender verknüpft, das ist die Höchstzahl. Entferne erst einen, dann kannst du einen neuen eintragen.</p>
  {:else}
    <form onsubmit={add}>
      <TextField
        label="Kalender-Link"
        name="calendar-link"
        autocomplete="off"
        hint="Den Link kopierst du in deinem Kalender (siehe Hilfe unten) und fügst ihn hier ein."
        error={linkError}
        bind:value={link}
        maxlength={CALENDAR_LINK_MAX_LENGTH}
        {disabled}
      />
      <TextField label="Name (freiwillig)" name="calendar-name" autocomplete="off" bind:value={name} maxlength={CALENDAR_NAME_MAX_LENGTH} {disabled} />
      {#if busy}<p class="checking" aria-live="polite">Kalender wird geprüft …</p>{/if}
      <Message text={formError} />
      <Message kind="success" text={done} />
      <div><Button type="submit" {disabled}>Kalender hinzufügen</Button></div>
    </form>
  {/if}

  <div class="help">
    <details>
      <summary>Google Kalender</summary>
      <ol>
        <li>Öffne Google Kalender am Computer und gehe zu den Einstellungen (Zahnrad).</li>
        <li>Wähle links unter „Einstellungen für meine Kalender“ den gewünschten Kalender aus.</li>
        <li>Öffne den Abschnitt „Integrierte Kalender“ (er heißt manchmal auch „Kalender integrieren“).</li>
        <li>Kopiere die „Privatadresse im iCal-Format“ und füge sie oben ein.</li>
      </ol>
      <p>Gib den Link niemandem sonst. Wer ihn hat, kann deinen Kalender lesen.</p>
    </details>
    <details>
      <summary>Apple iCloud</summary>
      <ol>
        <li>Öffne die Kalender-App auf dem Mac oder iCloud.com im Browser.</li>
        <li>Tippe bei dem Kalender auf „Kalender teilen“ (das Symbol mit der Person).</li>
        <li>Schalte „Öffentlicher Kalender“ ein.</li>
        <li>Kopiere den Link und füge ihn oben ein.</li>
      </ol>
      <p>Wichtig: Jeder, der diesen Link kennt, kann deinen Kalender lesen. Gib ihn nicht weiter.</p>
    </details>
    <details>
      <summary>Outlook</summary>
      <ol>
        <li>Öffne Outlook im Web und gehe zu Einstellungen → Kalender → Freigegebene Kalender.</li>
        <li>Wähle unter „Kalender veröffentlichen“ den Kalender aus.</li>
        <li>Wähle „Kann alle Details anzeigen“, wenn du die Titel in der Vorschau sehen möchtest, oder „Kann nur Verfügbarkeit anzeigen“.</li>
        <li>Klicke auf „Veröffentlichen“, kopiere den ICS-Link und füge ihn oben ein.</li>
      </ol>
    </details>
  </div>

  <p class="privacy">
    Der Link wird verschlüsselt gespeichert und nur vom Server gelesen. Deine Freunde sehen nie Termine, nur „belegt“
    oder „frei“. Danach zeigt dir die App nur noch den Anbieter, nie den Link.
  </p>
</Card>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .checking {
    font-weight: 500;
    color: var(--md-sys-color-primary);
  }

  .help {
    display: flex;
    flex-direction: column;
  }

  details {
    border-top: 1px solid var(--md-sys-color-outline-variant);
    padding: 0 0 8px;
  }

  summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 48px;
    list-style: none;
    font-weight: 500;
    color: var(--md-sys-color-on-surface);
    cursor: pointer;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary::after {
    content: "";
    flex: none;
    width: 8px;
    height: 8px;
    margin-right: 6px;
    border-right: 2px solid var(--md-sys-color-on-surface-variant);
    border-bottom: 2px solid var(--md-sys-color-on-surface-variant);
    transform: rotate(45deg);
    transition: transform 0.15s;
  }

  details[open] > summary::after {
    transform: rotate(-135deg);
  }

  details[open] > :not(summary) {
    margin-bottom: 8px;
  }

  ol {
    margin: 0;
    padding-left: 24px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  details p {
    font-size: 0.875rem;
  }

  .privacy {
    font-size: 0.875rem;
  }
</style>
