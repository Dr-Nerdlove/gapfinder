<script lang="ts">
  import type { CinemaInfo, Group, Person } from "@lueckenfueller/shared";
  import { onMount, untrack } from "svelte";
  import * as api from "../lib/api";
  import { cinemaSourceOf } from "../lib/cinema";
  import {
    CINEMA_NIGHT_MAX_DAYS_AHEAD,
    CINEMA_NIGHT_MIN_MINUTES,
    CINEMA_NIGHT_WINDOW,
    PERIOD_PROBLEM_TEXTS,
    checkPeriod,
    cinemaNightRequest,
    defaultPeriod,
    nightChoice,
    nightSummary,
    peopleLabel,
  } from "../lib/cinema-night";
  import { API_URL } from "../lib/config";
  import { REQUEST_PROBLEM_TEXTS, addDays, berlinToday, keepKnownPeople, loadSettings } from "../lib/gap-search";
  import { checkHealth, hasFeature } from "../lib/health";
  import { errorMessage } from "../lib/messages";
  import { pollSource } from "../lib/poll-draft";
  import { navigate } from "../lib/router";
  import { session, sessionState } from "../lib/session.svelte";
  import Button from "../components/Button.svelte";
  import Card from "../components/Card.svelte";
  import Message from "../components/Message.svelte";
  import OfflineNotice from "../components/OfflineNotice.svelte";
  import Page from "../components/Page.svelte";
  import PeoplePicker from "../components/search/PeoplePicker.svelte";

  const user = $derived(sessionState.user);
  const locked = $derived(sessionState.offline);
  const today = berlinToday();

  const remembered = nightChoice.get();
  const start = defaultPeriod(today);
  let chosenPeople = $state<number[]>(remembered?.people ?? loadSettings(today).people);
  let from = $state(remembered?.from ?? start.from);
  let to = $state(remembered?.to ?? start.to);
  let ticked = $state<number[]>(remembered?.cinemaIds ?? []);

  /** loading: asking the server; offline: no answer; unavailable: not an admin or the server lacks the feature. */
  let availability = $state<"loading" | "offline" | "unavailable" | "ok">("loading");
  let cinemas = $state<CinemaInfo[]>([]);
  let everyone = $state<Person[]>([]);
  let groups = $state<Group[]>([]);
  let peopleLoaded = $state(false);
  let searching = $state(false);
  let problem = $state("");

  const others = $derived(user ? everyone.filter((p) => p.id !== user.id) : []);
  const chosenNames = $derived(others.filter((p) => chosenPeople.includes(p.id)).map((p) => p.username));
  const summary = $derived(checkPeriod(from, to, today) === null ? nightSummary(from, to, chosenNames) : peopleLabel(chosenNames));

  async function load(): Promise<void> {
    availability = "loading";
    const health = await checkHealth(API_URL);
    if (health.kind !== "online") {
      availability = "offline";
      return;
    }
    const needed = ["cinema_film_choice", "cinema_showtimes", "proposal_place", "minute_times"] as const;
    if (sessionState.user?.isAdmin !== true || !needed.every((f) => hasFeature(health.features, f))) {
      availability = "unavailable";
      return;
    }
    try {
      const list = await session.run((o) => api.listCinemas(o));
      if (!list.ok) {
        availability = list.kind === "error" ? "unavailable" : "offline";
        return;
      }
      cinemas = list.data.cinemas;
      ticked = ticked.filter((id) => cinemas.some((c) => c.id === id));
      availability = cinemas.length > 0 ? "ok" : "unavailable";
    } catch {
      availability = "offline";
    }
  }

  onMount(() => {
    void load();
  });

  async function loadPeople(): Promise<void> {
    const result = await session.run((o) => api.listPeople(o));
    if (result.ok) {
      everyone = result.data.people;
      peopleLoaded = true;
      if (user) chosenPeople = keepKnownPeople(chosenPeople, everyone, user.id);
    }
  }

  // Groups are a convenience: without them the page works as well.
  async function loadGroups(): Promise<void> {
    const result = await session.run((o) => api.listGroups(o));
    if (result.ok) groups = result.data.groups;
  }

  $effect(() => {
    if (user && availability === "ok") untrack(() => void Promise.all([loadPeople(), loadGroups()]));
  });

  // Keeps the choices for the way back from step 2.
  $effect(() => {
    nightChoice.set({ people: $state.snapshot(chosenPeople), from, to, cinemaIds: $state.snapshot(ticked) });
  });

  function toggleCinema(id: number): void {
    ticked = ticked.includes(id) ? ticked.filter((i) => i !== id) : [...ticked, id];
  }

  /** Searches the free times, then hands over to the page that makes the poll (`manual`: the entry by hand opens at once). */
  async function go(manual: boolean): Promise<void> {
    if (!user || searching) return;
    problem = "";
    if (chosenPeople.length === 0) {
      problem = REQUEST_PROBLEM_TEXTS.no_people;
      return;
    }
    const periodProblem = checkPeriod(from, to, berlinToday());
    if (periodProblem !== null) {
      problem = PERIOD_PROBLEM_TEXTS[periodProblem];
      return;
    }
    if (!manual && ticked.length === 0) {
      problem = "Wähle mindestens ein Kino aus.";
      return;
    }
    const request = cinemaNightRequest(chosenPeople, from, to);
    searching = true;
    const result = await session.run((o) => api.searchGaps(request, o));
    searching = false;
    if (!result.ok) {
      if (result.kind === "error") problem = errorMessage(result);
      return;
    }
    const source = cinemaSourceOf(result.data, { from, to, window: { ...CINEMA_NIGHT_WINDOW }, durationMinutes: CINEMA_NIGHT_MIN_MINUTES }, everyone);
    if (source === null) {
      problem = "Die Suche hat keine freien Zeiten geliefert. Versuche es noch einmal.";
      return;
    }
    pollSource.set({
      picks: [],
      summary: nightSummary(from, to, chosenNames),
      durationMinutes: CINEMA_NIGHT_MIN_MINUTES,
      periodDays: 1,
      participants: [...request.people],
      cinema: source,
      cinemaFlow: { cinemaIds: [...ticked], manual },
    });
    navigate("#/abstimmung-neu");
  }
</script>

<Page title="Kinoabend planen">
  <OfflineNotice onretry={() => (availability === "offline" ? load() : undefined)} />
  {#if !user}
    <!-- Only reached while logging out. -->
  {:else if availability === "loading"}
    <Card><p aria-live="polite">Einen Moment …</p></Card>
  {:else if availability === "offline"}
    <Card title="Der Server ist gerade nicht erreichbar">
      <p>Sobald er wieder wach ist, kannst du hier den Kinoabend planen.</p>
      <div><Button variant="tonal" onclick={load}>Erneut versuchen</Button></div>
    </Card>
  {:else if availability === "unavailable"}
    <Card title="Gerade nicht möglich">
      <p>Den Kinoabend können nur Admins planen, und nur, wenn der Server Kinos kennt. Das ist hier im Moment nicht der Fall.</p>
      <div><Button href="#/suche">Zur Suche</Button></div>
    </Card>
  {:else}
    <form
      class="form"
      onsubmit={(event) => {
        event.preventDefault();
        void go(false);
      }}
    >
      <Card title="Kino-Vorschläge">
        <p class="hint">{summary}</p>
        <p class="hint">Schritt 1 von 3 · Wer, wann, welche Kinos</p>
      </Card>

      <Card title="Wer kommt mit?">
        <p class="hint">Du bist immer dabei.</p>
        {#if !peopleLoaded}
          <p class="hint" aria-live="polite">Einen Moment …</p>
        {:else if others.length === 0}
          <p>Außer dir gibt es noch niemanden. Lade Freunde ein, dann kannst du mit ihnen planen.</p>
        {:else}
          <PeoplePicker {others} bind:chosen={chosenPeople} {groups} {searching} {locked} ongroups={(next) => (groups = next)} />
        {/if}
      </Card>

      <Card title="Zeitraum">
        <div class="pair">
          <div class="field">
            <label for="night-from">Von</label>
            <input id="night-from" type="date" min={today} max={addDays(today, CINEMA_NIGHT_MAX_DAYS_AHEAD)} bind:value={from} />
          </div>
          <div class="field">
            <label for="night-to">Bis</label>
            <input id="night-to" type="date" min={from || today} max={addDays(today, CINEMA_NIGHT_MAX_DAYS_AHEAD)} bind:value={to} />
          </div>
        </div>
        <p class="hint">Frei wählbar, höchstens {CINEMA_NIGHT_MAX_DAYS_AHEAD} Tage im Voraus (so weit reichen die Spielzeiten).</p>
      </Card>

      <Card title="Kinos wählen">
        <div class="list">
          {#each cinemas as cinema (cinema.id)}
            {@const on = ticked.includes(cinema.id)}
            <label class="pick" class:on>
              <input type="checkbox" checked={on} onchange={() => toggleCinema(cinema.id)} />
              <span class="text">
                <strong>{cinema.name}</strong>
                {#if cinema.room}<span class="reason">Saal: {cinema.room}</span>{/if}
              </span>
            </label>
          {/each}
        </div>
        <p class="hint">
          Spielzeiten werden nur für Tage geholt, an denen ihr alle mindestens 1½ Stunden am Stück frei seid. Kein Uhrzeitfenster: jede Vorstellung zählt, in der alle laut Kalender Zeit haben.
        </p>
        <p class="hint">Test: Diesen Abschnitt sehen nur Admins.</p>
      </Card>

      <Message text={problem} />
      <div class="center">
        <Button type="submit" full disabled={searching || locked}>
          {searching ? "Freie Zeiten werden gesucht …" : `Filme anzeigen (${ticked.length} ${ticked.length === 1 ? "Kino" : "Kinos"})`}
        </Button>
        <p class="hint">Spielzeiten: Cineamo</p>
        {#if !searching}<button type="button" class="link" onclick={() => void go(true)} disabled={locked}>Zeiten selbst eintragen</button>{/if}
      </div>
    </form>
  {/if}
</Page>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .center :global(.button) {
    width: 100%;
  }

  .hint {
    font-size: 0.875rem;
    color: var(--md-sys-color-on-surface-variant);
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

  label:not(.pick) {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--md-sys-color-on-surface-variant);
  }

  input[type="date"] {
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

  .link {
    padding: 8px;
    border: 0;
    background: none;
    color: var(--md-sys-color-primary);
    font: inherit;
    font-weight: 500;
    text-decoration: underline;
    cursor: pointer;
    min-height: 40px;
  }

  .pick {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 48px;
    padding: 10px 14px;
    border: 2px solid var(--md-sys-color-outline-variant);
    border-radius: 16px;
    background: var(--md-sys-color-surface);
    color: var(--md-sys-color-on-surface);
    cursor: pointer;
  }

  .pick.on {
    border-color: var(--md-sys-color-primary);
  }

  .pick input {
    width: 22px;
    height: 22px;
    flex: none;
    accent-color: var(--md-sys-color-primary);
  }

  .text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    min-width: 0;
  }

  .reason {
    font-size: 0.8125rem;
    color: var(--md-sys-color-on-surface-variant);
  }
</style>
