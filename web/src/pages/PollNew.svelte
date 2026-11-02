<script lang="ts">
  import type { Person } from "@lueckenfueller/shared";
  import { POLL_NOTE_MAX_LENGTH, POLL_TITLE_MAX_LENGTH } from "@lueckenfueller/shared";
  import { untrack } from "svelte";
  import * as api from "../lib/api";
  import { berlinToday } from "../lib/gap-search";
  import { errorMessage } from "../lib/messages";
  import {
    DRAFT_PROBLEM_TEXTS,
    buildCreateRequest,
    draftFromSource,
    pollSource,
    type DraftItem as Item,
  } from "../lib/poll-draft";
  import { navigate } from "../lib/router";
  import { session, sessionState } from "../lib/session.svelte";
  import Button from "../components/Button.svelte";
  import Card from "../components/Card.svelte";
  import Message from "../components/Message.svelte";
  import OfflineNotice from "../components/OfflineNotice.svelte";
  import Page from "../components/Page.svelte";
  import DraftItem from "../components/polls/DraftItem.svelte";
  import TextField from "../components/TextField.svelte";

  const source = pollSource.get();
  const today = berlinToday();

  let title = $state("");
  let note = $state("");
  let deadlineDate = $state("");
  let deadlineTime = $state("");
  let items = $state<Item[]>(source ? draftFromSource(source, today) : []);
  let problem = $state("");
  let problemItem = $state("");
  let busy = $state(false);
  let people = $state<Person[]>([]);

  // Names of the invited people, as far as the server is awake; otherwise only their number is shown.
  $effect(() => {
    if (sessionState.user && source) untrack(() => void loadPeople());
  });
  async function loadPeople(): Promise<void> {
    const result = await session.run((o) => api.listPeople(o));
    if (result.ok) people = result.data.people;
  }
  const invited = $derived.by(() => {
    if (!source) return "";
    const names = source.participants.flatMap((id) => people.find((p) => p.id === id)?.username ?? []);
    if (names.length === source.participants.length && names.length > 0) return `Eingeladen: ${names.join(", ")} und du`;
    return source.participants.length === 0 ? "Nur du bist dabei." : `Eingeladen: ${source.participants.length} weitere Personen und du`;
  });

  async function create(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!source || busy) return;
    problem = "";
    problemItem = "";
    const check = buildCreateRequest({
      title,
      note,
      deadlineDate,
      deadlineTime,
      items: $state.snapshot(items),
      participants: source.participants,
    });
    if (!check.ok) {
      problem = DRAFT_PROBLEM_TEXTS[check.problem];
      problemItem = check.itemId ?? "";
      return;
    }
    busy = true;
    const result = await session.run((o) => api.createPoll(check.request, o));
    busy = false;
    if (result.ok) {
      pollSource.clear();
      navigate(`#/abstimmung/${encodeURIComponent(result.data.shareToken)}`);
    } else {
      problem = errorMessage(result);
    }
  }
</script>

<Page title="Neue Abstimmung" subtitle="Deine Freunde stimmen über die Termine ab.">
  <OfflineNotice />
  {#if !source || items.length === 0}
    <Card title="Noch keine Termine gewählt">
      <p>Suche zuerst nach Lücken und tippe dort auf die Zeiten, die du vorschlagen möchtest.</p>
      <div><Button href="#/suche">Zur Suche</Button></div>
    </Card>
  {:else}
    <form onsubmit={create} class="form">
      <Card>
        <TextField label="Titel" bind:value={title} maxlength={POLL_TITLE_MAX_LENGTH} required hint="Zum Beispiel „Spieleabend“." />
        <div class="field">
          <label for="note">Notiz (optional)</label>
          <textarea id="note" rows="3" maxlength={POLL_NOTE_MAX_LENGTH} bind:value={note}></textarea>
          <p class="hint">Zum Beispiel der Ort.</p>
        </div>
        <fieldset>
          <legend>Abstimmen möglich bis (optional)</legend>
          <div class="pair">
            <div class="field">
              <label for="deadline-date">Tag</label>
              <input id="deadline-date" type="date" min={today} bind:value={deadlineDate} />
            </div>
            <div class="field">
              <label for="deadline-time">Uhrzeit</label>
              <input id="deadline-time" type="time" step="900" bind:value={deadlineTime} />
            </div>
          </div>
        </fieldset>
      </Card>

      <Card title="Termine">
        <p class="hint">{source.summary}</p>
        {#each items as item, index (item.id)}
          <DraftItem {item} problem={problemItem === item.id} onchange={(next) => (items[index] = next)} />
        {/each}
        <p class="hint">{invited}</p>
      </Card>

      <Message text={problem} />
      <Button type="submit" disabled={busy || sessionState.offline} full>{busy ? "Wird erstellt …" : "Abstimmung erstellen"}</Button>
    </form>
  {/if}
</Page>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .field {
    display: flex;
    min-width: 0;
    flex: 1 1 0;
    flex-direction: column;
    gap: 4px;
  }

  label,
  legend {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--md-sys-color-on-surface-variant);
  }

  fieldset {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .pair {
    display: flex;
    gap: 12px;
  }

  textarea,
  input[type="date"],
  input[type="time"] {
    padding: 12px 16px;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: 12px;
    background: var(--md-sys-color-surface);
    color: var(--md-sys-color-on-surface);
    font: inherit;
    min-height: 48px;
    min-width: 0;
    width: 100%;
  }

  .hint {
    font-size: 0.875rem;
  }
</style>
