<script lang="ts">
  import type { Calendar } from "@lueckenfueller/shared";
  import { CALENDAR_NAME_MAX_LENGTH } from "@lueckenfueller/shared";
  import * as api from "../../lib/api";
  import { looksLikeCalendarLink, providerLabel } from "../../lib/calendars";
  import { ERROR_MESSAGES, errorMessage } from "../../lib/messages";
  import { session } from "../../lib/session.svelte";
  import Button from "../Button.svelte";
  import Card from "../Card.svelte";
  import ConfirmDialog from "../ConfirmDialog.svelte";
  import Message from "../Message.svelte";
  import TextField from "../TextField.svelte";

  interface Props {
    calendars: Calendar[];
    /** Offline: nothing can be changed. */
    locked: boolean;
    /** A calendar was changed on the server (the answer already has the new state). */
    onchanged: (calendar: Calendar, eventsMayHaveChanged: boolean) => void;
    onremoved: (id: number) => void;
  }

  let { calendars, locked, onchanged, onremoved }: Props = $props();

  let busy = $state(false);
  let editing = $state<{ id: number; mode: "rename" | "relink" } | null>(null);
  let editValue = $state("");
  let editError = $state("");
  let rowError = $state<{ id: number; text: string } | null>(null);
  let removing = $state<Calendar | null>(null);

  const disabled = $derived(busy || locked);

  function startEdit(calendar: Calendar, mode: "rename" | "relink"): void {
    editing = { id: calendar.id, mode };
    editValue = mode === "rename" ? calendar.name : "";
    editError = "";
    rowError = null;
  }

  /** Opens the "Link neu eintragen" form of a calendar and scrolls to it (from the preview's notice). */
  export function startRelink(id: number): void {
    const calendar = calendars.find((c) => c.id === id);
    if (!calendar) return;
    startEdit(calendar, "relink");
    document.getElementById(`calendar-${id}`)?.scrollIntoView({ block: "center" });
  }

  async function update(calendar: Calendar, changes: Parameters<typeof api.updateCalendar>[1]): Promise<Calendar | null> {
    const eventsMayHaveChanged = changes.countsAsBusy !== undefined || changes.link !== undefined;
    rowError = null;
    busy = true;
    const result = await session.run((o) => api.updateCalendar(calendar.id, changes, o));
    busy = false;
    if (result.ok) {
      onchanged(result.data, eventsMayHaveChanged);
      return result.data;
    }
    rowError = { id: calendar.id, text: errorMessage(result) };
    return null;
  }

  async function saveEdit(event: SubmitEvent, calendar: Calendar): Promise<void> {
    event.preventDefault();
    if (!editing) return;
    editError = "";
    if (editing.mode === "rename") {
      const name = editValue.trim();
      if (name === "") {
        editError = "Bitte gib einen Namen ein.";
        return;
      }
      rowError = null;
      busy = true;
      const result = await session.run((o) => api.updateCalendar(calendar.id, { name }, o));
      busy = false;
      if (result.ok) {
        editing = null;
        onchanged(result.data, false);
      } else {
        editError = errorMessage(result);
      }
      return;
    }
    const link = editValue.trim();
    if (!looksLikeCalendarLink(link)) {
      editError = ERROR_MESSAGES.calendar_link_invalid;
      return;
    }
    rowError = null;
    busy = true;
    const result = await session.run((o) => api.updateCalendar(calendar.id, { link }, o));
    busy = false;
    if (result.ok) {
      editing = null;
      editValue = "";
      onchanged(result.data, true);
    } else {
      editError = errorMessage(result);
    }
  }

  async function toggleBusy(event: Event, calendar: Calendar): Promise<void> {
    const box = event.currentTarget as HTMLInputElement;
    const saved = await update(calendar, { countsAsBusy: box.checked });
    // A failed change must not leave the switch in the new position.
    if (!saved) box.checked = calendar.countsAsBusy;
  }

  async function confirmRemove(): Promise<void> {
    const calendar = removing;
    if (!calendar) return;
    rowError = null;
    busy = true;
    const result = await session.run((o) => api.deleteCalendar(calendar.id, o));
    busy = false;
    removing = null;
    if (result.ok || (result.kind === "error" && result.code === "not_found")) onremoved(calendar.id);
    else rowError = { id: calendar.id, text: errorMessage(result) };
  }
</script>

<Card title="Deine Kalender">
  <ul>
    {#each calendars as calendar (calendar.id)}
      <li id="calendar-{calendar.id}">
        <div class="head">
          <strong>{calendar.name}</strong>
          {#if calendar.isDefault}<span class="badge">Standard</span>{/if}
        </div>
        <p class="provider">{providerLabel(calendar.provider)}</p>

        {#if calendar.status === "broken"}
          <div class="problem" role="alert">
            <p>Dieser Link funktioniert nicht mehr.</p>
            <Button variant="tonal" {disabled} onclick={() => startEdit(calendar, "relink")}>Link neu eintragen</Button>
          </div>
        {/if}

        <label class="switch">
          <input type="checkbox" role="switch" checked={calendar.countsAsBusy} {disabled} onchange={(e) => toggleBusy(e, calendar)} />
          <span class="track" aria-hidden="true"></span>
          <span class="label">Zählt als belegt</span>
        </label>
        {#if !calendar.countsAsBusy}
          <p class="provider">Termine aus diesem Kalender machen dich nicht belegt.</p>
        {/if}

        {#if editing?.id === calendar.id}
          <form onsubmit={(e) => saveEdit(e, calendar)}>
            {#if editing.mode === "rename"}
              <TextField label="Neuer Name" autocomplete="off" maxlength={CALENDAR_NAME_MAX_LENGTH} error={editError} bind:value={editValue} {disabled} />
            {:else}
              <TextField
                label="Neuer Kalender-Link"
                autocomplete="off"
                hint="Kopiere den Link neu aus deinem Kalender und füge ihn hier ein."
                error={editError}
                bind:value={editValue}
                {disabled}
              />
            {/if}
            {#if busy}<p class="checking" aria-live="polite">Kalender wird geprüft …</p>{/if}
            <div class="actions">
              <Button type="submit" {disabled}>{editing.mode === "rename" ? "Speichern" : "Prüfen und speichern"}</Button>
              <Button variant="text" {disabled} onclick={() => (editing = null)}>Abbrechen</Button>
            </div>
          </form>
        {:else}
          <div class="actions">
            {#if !calendar.isDefault}
              <Button variant="text" {disabled} onclick={() => update(calendar, { isDefault: true })}>Als Standard</Button>
            {/if}
            <Button variant="text" {disabled} onclick={() => startEdit(calendar, "rename")}>Umbenennen</Button>
            {#if calendar.status !== "broken"}
              <Button variant="text" {disabled} onclick={() => startEdit(calendar, "relink")}>Link neu eintragen</Button>
            {/if}
            <Button variant="text" {disabled} onclick={() => (removing = calendar)}>Entfernen</Button>
          </div>
        {/if}
        {#if rowError?.id === calendar.id}<Message text={rowError.text} />{/if}
      </li>
    {/each}
  </ul>
</Card>

<ConfirmDialog
  open={removing !== null}
  title="„{removing?.name ?? ''}“ entfernen?"
  text="Der Kalender wird aus Lückenfüller entfernt. In deinem Kalender selbst ändert sich nichts."
  confirmLabel="Entfernen"
  {busy}
  onconfirm={confirmRemove}
  oncancel={() => (removing = null)}
/>

<style>
  ul {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px 0;
    border-top: 1px solid var(--md-sys-color-outline-variant);
  }

  li:first-child {
    padding-top: 0;
    border-top: 0;
  }

  li:last-child {
    padding-bottom: 0;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  strong {
    overflow-wrap: anywhere;
    color: var(--md-sys-color-on-surface);
  }

  .badge {
    padding: 2px 10px;
    border-radius: 8px;
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-primary-container);
    font-size: 0.875rem;
    font-weight: 500;
  }

  .provider {
    margin-top: -4px;
    font-size: 0.875rem;
  }

  .problem {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 12px 16px;
    border-radius: 16px;
    background: var(--md-sys-color-error-container);
    color: var(--md-sys-color-on-error-container);
    font-weight: 500;
  }

  .switch {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 48px;
    cursor: pointer;
    position: relative;
  }

  .switch input {
    position: absolute;
    inset: 0 auto 0 0;
    width: 52px;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: inherit;
  }

  .track {
    position: relative;
    flex: none;
    width: 52px;
    height: 32px;
    border: 2px solid var(--md-sys-color-outline);
    border-radius: 16px;
    background: var(--md-sys-color-surface-variant);
    box-sizing: border-box;
    transition: background 0.15s;
  }

  .track::after {
    content: "";
    position: absolute;
    top: 6px;
    left: 6px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--md-sys-color-outline);
    transition:
      transform 0.15s,
      width 0.15s,
      height 0.15s,
      top 0.15s,
      background 0.15s;
  }

  input:checked + .track {
    border-color: var(--md-sys-color-primary);
    background: var(--md-sys-color-primary);
  }

  input:checked + .track::after {
    top: 2px;
    left: 2px;
    width: 24px;
    height: 24px;
    transform: translateX(20px);
    background: var(--md-sys-color-on-primary);
  }

  input:focus-visible + .track {
    outline: 3px solid var(--md-sys-color-primary);
    outline-offset: 2px;
  }

  input:disabled + .track,
  input:disabled ~ .label {
    opacity: 0.5;
  }

  .switch:has(input:disabled) {
    cursor: not-allowed;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .checking {
    font-weight: 500;
    color: var(--md-sys-color-primary);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-left: -16px;
  }

  form .actions {
    margin-left: 0;
  }
</style>
