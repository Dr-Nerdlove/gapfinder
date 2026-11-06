<script lang="ts">
  import type { Calendar } from "@lueckenfueller/shared";
  import { CALENDAR_NAME_MAX_LENGTH, CALENDAR_LINK_MAX_LENGTH, CALENDARS_PER_USER } from "@lueckenfueller/shared";
  import * as api from "../../lib/api";
  import { calendarDisplayName, canAddCalendar, looksLikeCalendarLink } from "../../lib/calendars";
  import { ERROR_MESSAGES, errorMessage } from "../../lib/messages";
  import { session } from "../../lib/session.svelte";
  import Button from "../Button.svelte";
  import Card from "../Card.svelte";
  import CalendarGuide from "./CalendarGuide.svelte";
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
    <CalendarGuide />
    <form onsubmit={add}>
      <TextField
        label="Kalender-Link"
        name="calendar-link"
        autocomplete="off"
        hint="Füge den kopierten Link hier ein. Am Handy: lange auf das Feld tippen und „Einsetzen“ wählen."
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
    <p class="note">
      Deine Freunde sehen nie deine Termine, nur „belegt“ oder „frei“. Der Link wird verschlüsselt gespeichert.<br />
      <a href="#/privatsphaere">Was mit deinem Kalender passiert</a>
    </p>
  {/if}
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

  .note {
    font-size: 0.875rem;
  }

  .note a {
    color: var(--md-sys-color-primary);
    font-weight: 500;
  }
</style>
