<script lang="ts">
  import type { PollView, UpdatePollRequest } from "@lueckenfueller/shared";
  import { berlinToday } from "../../lib/gap-search";
  import { DRAFT_PROBLEM_TEXTS, berlinParts, deadlineOf } from "../../lib/poll-draft";
  import Button from "../Button.svelte";
  import Card from "../Card.svelte";
  import ConfirmDialog from "../ConfirmDialog.svelte";
  import Message from "../Message.svelte";

  interface Props {
    poll: PollView;
    busy: boolean;
    locked: boolean;
    /** The text of a failed action. */
    problem: string;
    onupdate: (changes: UpdatePollRequest) => void;
    onnewlink: () => void;
    ondelete: () => void;
  }

  let { poll, busy, locked, problem, onupdate, onnewlink, ondelete }: Props = $props();

  const parts = $derived(poll.deadline ? berlinParts(poll.deadline) : { date: "", time: "" });
  let date = $state("");
  let time = $state("");
  let inputProblem = $state("");
  let confirming = $state<"link" | "delete" | null>(null);

  // Show the deadline the poll really has (also after a refresh), unless the person is typing a new one.
  let shown = $state<string | null | undefined>(undefined);
  $effect(() => {
    if (shown === poll.deadline) return;
    shown = poll.deadline;
    date = parts.date;
    time = parts.time;
  });

  function saveDeadline(event: SubmitEvent): void {
    event.preventDefault();
    inputProblem = "";
    const result = deadlineOf(date, time, new Date());
    if (!result.ok) {
      inputProblem = DRAFT_PROBLEM_TEXTS[result.problem];
      return;
    }
    onupdate({ deadline: result.value });
  }

  function confirm(): void {
    const what = confirming;
    confirming = null;
    if (what === "link") onnewlink();
    if (what === "delete") ondelete();
  }
</script>

<Card title="Verwalten">
  <p class="note">Das sehen nur du als Ersteller und der Admin.</p>
  <form onsubmit={saveDeadline} class="deadline">
    <fieldset>
      <legend>Frist</legend>
      <div class="pair">
        <div class="field">
          <label for="manage-date">Tag</label>
          <input id="manage-date" type="date" min={berlinToday()} bind:value={date} />
        </div>
        <div class="field">
          <label for="manage-time">Uhrzeit</label>
          <input id="manage-time" type="time" step="1800" bind:value={time} />
        </div>
      </div>
    </fieldset>
    <div class="actions">
      <Button type="submit" variant="tonal" disabled={busy || locked}>Frist speichern</Button>
      {#if poll.deadline}
        <Button variant="text" disabled={busy || locked} onclick={() => onupdate({ deadline: null })}>Frist entfernen</Button>
      {/if}
    </div>
  </form>
  <Message text={inputProblem} />

  <div class="actions">
    <Button variant="tonal" disabled={busy || locked} onclick={() => onupdate({ closed: !poll.closed })}>
      {poll.closed ? "Wieder öffnen" : "Abstimmung schließen"}
    </Button>
    <Button variant="tonal" disabled={busy || locked} onclick={() => (confirming = "link")}>Neuer Link</Button>
    <Button variant="danger" disabled={busy || locked} onclick={() => (confirming = "delete")}>Abstimmung löschen</Button>
  </div>
  {#if poll.closed && poll.deadline && !poll.open}
    <p class="note">Die Frist ist schon abgelaufen. Setze erst eine neue Frist, sonst bleibt die Abstimmung nach dem Öffnen beendet.</p>
  {/if}
  <Message text={problem} />
</Card>

<ConfirmDialog
  open={confirming === "link"}
  title="Neuen Link erzeugen?"
  text="Der alte Link funktioniert danach nicht mehr. Alle, die abstimmen wollen, brauchen den neuen Link. Gäste können ihre alte Stimme dann nicht mehr ändern."
  confirmLabel="Neuer Link"
  {busy}
  onconfirm={confirm}
  oncancel={() => (confirming = null)}
/>
<ConfirmDialog
  open={confirming === "delete"}
  title="Abstimmung löschen?"
  text="Die Abstimmung und alle Stimmen werden gelöscht. Das lässt sich nicht rückgängig machen."
  confirmLabel="Löschen"
  {busy}
  onconfirm={confirm}
  oncancel={() => (confirming = null)}
/>

<style>
  .note {
    font-size: 0.875rem;
  }

  .deadline {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  legend,
  label {
    font-size: 0.875rem;
    font-weight: 500;
  }

  .pair {
    display: flex;
    gap: 12px;
  }

  .field {
    display: flex;
    min-width: 0;
    flex: 1 1 0;
    flex-direction: column;
    gap: 4px;
  }

  input {
    min-height: 48px;
    min-width: 0;
    width: 100%;
    padding: 0 12px;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: 12px;
    background: var(--md-sys-color-surface);
    color: var(--md-sys-color-on-surface);
    font: inherit;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
