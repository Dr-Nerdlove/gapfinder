<script lang="ts">
  import type { CinemaInfo, CreatePollRequest, Person } from "@lueckenfueller/shared";
  import { POLL_NOTE_MAX_LENGTH, POLL_TITLE_MAX_LENGTH } from "@lueckenfueller/shared";
  import { onMount, untrack } from "svelte";
  import * as api from "../lib/api";
  import { berlinToday } from "../lib/gap-search";
  import { CINEMA_PROBLEM_TEXTS, cinemaRequest, cinemaSubmitLabel, type CheckedShowing } from "../lib/cinema";
  import { errorMessage } from "../lib/messages";
  import {
    DRAFT_PROBLEM_TEXTS,
    buildCreateRequest,
    draftFromSource,
    pollSource,
    type DraftItem as Item,
  } from "../lib/poll-draft";
  import { API_URL } from "../lib/config";
  import { checkHealth, hasFeature } from "../lib/health";
  import { navigate } from "../lib/router";
  import { session, sessionState } from "../lib/session.svelte";
  import Button from "../components/Button.svelte";
  import Card from "../components/Card.svelte";
  import Message from "../components/Message.svelte";
  import OfflineNotice from "../components/OfflineNotice.svelte";
  import Page from "../components/Page.svelte";
  import CinemaEntry from "../components/polls/CinemaEntry.svelte";
  import CinemaFilmChoice from "../components/polls/CinemaFilmChoice.svelte";
  import DraftItem from "../components/polls/DraftItem.svelte";
  import Switch from "../components/Switch.svelte";
  import TextField from "../components/TextField.svelte";

  const source = pollSource.get();
  const today = berlinToday();

  let title = $state(source?.title ?? "");
  let note = $state(source?.note ?? "");
  let deadlineDate = $state("");
  let deadlineTime = $state("");
  let items = $state<Item[]>(source ? draftFromSource(source, today) : []);
  let chosenShowings = $state<CheckedShowing[]>([]);
  let problem = $state("");
  let problemItem = $state("");
  let busy = $state(false);
  let people = $state<Person[]>([]);
  let hidden = $state(source?.hidden === true);
  // The switch is offered only when the server says it knows hidden votes (an older server would ignore the field).
  let canHide = $state(false);
  // The same for the place of a proposal.
  let canPlace = $state(false);

  // The cinemas of the admin-only test of fetching showtimes; empty for everybody else and on any failure.
  let cinemas = $state<CinemaInfo[]>([]);
  // The film choice (three steps) instead of the entry by hand: only when the server offers it too. `choiceReady`: the choice has reached its last step.
  let filmChoice = $state(false);
  let choiceReady = $state(false);
  // The cinema flow needs to know whether the cinemas have been asked for yet (an unanswered question is no "not available").
  let cinemasAsked = $state(false);

  onMount(() => {
    void checkHealth(API_URL).then((result) => {
      canHide = result.kind === "online" && hasFeature(result.features, "hidden_votes");
      canPlace = result.kind === "online" && hasFeature(result.features, "proposal_place");
      if (result.kind === "online" && hasFeature(result.features, "cinema_showtimes") && sessionState.user?.isAdmin === true) {
        void session
          .run((o) => api.listCinemas(o))
          .then((list) => {
            if (list.ok) {
              cinemas = list.data.cinemas;
              filmChoice = cinemas.length > 0 && hasFeature(result.features, "cinema_film_choice");
            }
          })
          .catch(() => {})
          .finally(() => (cinemasAsked = true));
      } else {
        cinemasAsked = true;
      }
    });
  });

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
    if (source.cinema) {
      const cinema = cinemaRequest({
        title,
        note,
        deadlineDate,
        deadlineTime,
        showings: $state.snapshot(chosenShowings),
        participants: source.participants,
        hidden: canHide && hidden,
      });
      if (!cinema.ok) {
        problem = CINEMA_PROBLEM_TEXTS[cinema.problem];
        return;
      }
      await send(cinema.request);
      return;
    }
    const check = buildCreateRequest({
      title,
      note,
      deadlineDate,
      deadlineTime,
      // An older server ignores a place: do not send one.
      items: $state.snapshot(items).map((item) => (canPlace ? item : { ...item, place: "" })),
      participants: source.participants,
      hidden: canHide && hidden,
    });
    if (!check.ok) {
      problem = DRAFT_PROBLEM_TEXTS[check.problem];
      problemItem = check.itemId ?? "";
      return;
    }
    await send(check.request);
  }

  async function send(request: CreatePollRequest): Promise<void> {
    busy = true;
    const result = await session.run((o) => api.createPoll(request, o));
    busy = false;
    if (result.ok) {
      pollSource.clear();
      navigate(`#/abstimmung/${encodeURIComponent(result.data.shareToken)}`, { replace: true });
    } else {
      problem = errorMessage(result);
    }
  }
</script>

<Page title="Neue Abstimmung" subtitle="Deine Freunde stimmen über die Termine ab.">
  <OfflineNotice />
  {#if !source || (items.length === 0 && !source.cinema)}
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
              <input id="deadline-time" type="time" step="1800" bind:value={deadlineTime} />
            </div>
          </div>
        </fieldset>
        {#if canHide}
          <div class="hide">
            <Switch label="Stimmen verdecken" checked={hidden} onchange={(value) => (hidden = value)} />
            <p class="hint">
              Die anderen sehen nur, wie viele Ja, Vielleicht und Nein es pro Termin gibt und wer noch nicht abgestimmt hat. Wer was gewählt hat, siehst nur du.
            </p>
          </div>
        {/if}
      </Card>

      {#if source.cinema}
        {#if filmChoice}
          <CinemaFilmChoice
            source={source.cinema}
            bind:chosen={chosenShowings}
            bind:ready={choiceReady}
            {cinemas}
            flow={source.cinemaFlow ? { ...source.cinemaFlow, summary: source.summary } : undefined}
          />
        {:else if source.cinemaFlow && !cinemasAsked}
          <Card><p aria-live="polite">Einen Moment …</p></Card>
        {:else if source.cinemaFlow}
          <Card title="Kinoabend gerade nicht möglich">
            <p>Der Server kennt die Kinos im Moment nicht oder ist nicht erreichbar.</p>
            <div><Button href="#/kinoabend">Zurück zum Kinoabend</Button></div>
          </Card>
        {:else}
          <CinemaEntry source={source.cinema} bind:chosen={chosenShowings} {cinemas} />
        {/if}
        <p class="hint">{invited}</p>
      {:else}
        <Card title="Termine">
          <p class="hint">{source.summary}</p>
          {#each items as item, index (item.id)}
            <DraftItem {item} {canPlace} problem={problemItem === item.id} onchange={(next) => (items[index] = next)} />
          {/each}
          <p class="hint">{invited}</p>
        </Card>
      {/if}

      <Message text={problem} />
      {#if !(source.cinema && filmChoice && !choiceReady) && !(source.cinemaFlow && !filmChoice)}
        <Button type="submit" disabled={busy || sessionState.offline} full>{busy ? "Wird erstellt …" : source.cinema ? cinemaSubmitLabel(chosenShowings.length) : "Abstimmung erstellen"}</Button>
      {/if}
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
    min-width: 0;
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
