<script lang="ts">
  import { NEAR_MISS_MIN_PEOPLE, type Group, type Person, type SearchRequest, type SkippedPerson } from "@lueckenfueller/shared";
  import { tick, untrack } from "svelte";
  import * as api from "../lib/api";
  import {
    REQUEST_PROBLEM_TEXTS,
    type PollPick,
    berlinToday,
    buildRequest,
    keepKnownPeople,
    loadSettings,
    readablePeople,
    requestSummary,
    resultView,
    saveSettings,
    skippedNotices,
    type ResultView,
  } from "../lib/gap-search";
  import { errorMessage } from "../lib/messages";
  import { MAX_PICKS, pollSource, selectionLabel, togglePick } from "../lib/poll-draft";
  import { navigate } from "../lib/router";
  import { session, sessionState } from "../lib/session.svelte";
  import Button from "../components/Button.svelte";
  import Card from "../components/Card.svelte";
  import Message from "../components/Message.svelte";
  import OfflineNotice from "../components/OfflineNotice.svelte";
  import Page from "../components/Page.svelte";
  import SearchForm from "../components/search/SearchForm.svelte";
  import SearchResults from "../components/search/SearchResults.svelte";

  const user = $derived(sessionState.user);
  const locked = $derived(sessionState.offline);
  const today = berlinToday();

  let settings = $state(loadSettings(today));
  let everyone = $state<Person[]>([]);
  let loadingPeople = $state(true);
  let peopleLoaded = $state(false);
  let loadError = $state("");
  let groups = $state<Group[]>([]);

  let searching = $state(false);
  let problem = $state("");
  let latest = 0;
  let resultBox = $state<HTMLElement>();
  interface Answer {
    summary: string;
    notices: string[];
    view: ResultView;
    nearMissesPossible: boolean;
    /** What a poll made from this answer needs to know about the search. */
    source: { durationMinutes: number; periodDays: number; participants: number[] };
  }
  let selected = $state<PollPick[]>([]);
  let answer = $state<Answer | null>(null);

  const others = $derived(user ? everyone.filter((p) => p.id !== user.id) : []);

  async function loadPeople(): Promise<void> {
    loadingPeople = true;
    loadError = "";
    const result = await session.run((o) => api.listPeople(o));
    loadingPeople = false;
    if (result.ok) {
      everyone = result.data.people;
      peopleLoaded = true;
      if (user) settings.people = keepKnownPeople(settings.people, everyone, user.id);
    } else if (result.kind === "error") {
      loadError = errorMessage(result);
    }
    // Offline: the notice explains it; the chosen people stay as the device remembers them.
  }

  // Groups are a convenience: when they cannot be loaded the search works without them.
  async function loadGroups(): Promise<void> {
    const result = await session.run((o) => api.listGroups(o));
    if (result.ok) groups = result.data.groups;
  }

  $effect(() => {
    if (user) untrack(() => void Promise.all([loadPeople(), loadGroups()]));
  });

  // The device remembers the last settings (also what was chosen but not searched yet).
  $effect(() => {
    saveSettings($state.snapshot(settings));
  });

  async function search(): Promise<void> {
    if (!user || searching) return;
    problem = "";
    const built = buildRequest($state.snapshot(settings), berlinToday());
    if (!built.ok) {
      problem = REQUEST_PROBLEM_TEXTS[built.problem];
      return;
    }
    const request: SearchRequest = built.request;
    const mine = ++latest;
    searching = true;
    const result = await session.run((o) => api.searchGaps(request, o));
    if (mine !== latest) return;
    searching = false;
    if (result.ok) {
      const skipped: SkippedPerson[] = result.data.skipped;
      const readable = readablePeople(request.people.length, skipped);
      answer = {
        summary: requestSummary(request),
        notices: skippedNotices(skipped, everyone, user.id),
        view: resultView(result.data, everyone, user.id, readable),
        nearMissesPossible: readable >= NEAR_MISS_MIN_PEOPLE,
        source: {
          durationMinutes: request.mode === "hours" ? request.durationMinutes : 0,
          periodDays: request.mode === "days" ? request.days : 1,
          participants: [...request.people],
        },
      };
      selected = []; // the chosen times belong to the old answer
      await tick();
      resultBox?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (result.kind === "error") {
      problem = errorMessage(result);
    }
    // Offline: the notice above explains it; the last result stays and the settings are not lost.
  }

  function toggle(pick: PollPick): void {
    selected = togglePick(selected, pick);
  }

  function makePoll(): void {
    if (!answer || selected.length === 0) return;
    pollSource.set({ picks: [...selected], summary: answer.summary, ...answer.source });
    navigate("#/abstimmung-neu");
  }
</script>

<Page title="Lücken suchen" subtitle="Wann haben alle Zeit?">
  <OfflineNotice onretry={() => (peopleLoaded ? undefined : loadPeople())} />
  {#if !user}
    <!-- Only reached while logging out. -->
  {:else if loadError}
    <Card>
      <Message text={loadError} />
      <div><Button variant="tonal" onclick={loadPeople}>Erneut versuchen</Button></div>
    </Card>
  {:else if loadingPeople && !peopleLoaded}
    <Card><p aria-live="polite">Einen Moment …</p></Card>
  {:else if !peopleLoaded}
    <Card title="Personen können gerade nicht geladen werden">
      <p>Sobald der Server wieder wach ist, kannst du hier Freunde auswählen. Deine letzte Auswahl bleibt erhalten.</p>
    </Card>
  {:else}
    <SearchForm bind:settings {others} {groups} ongroups={(next) => (groups = next)} {today} {searching} {locked} {problem} onsearch={search} />
    {#if answer}
      <div bind:this={resultBox} class="scroll-target">
        <SearchResults
          summary={answer.summary}
          notices={answer.notices}
          everyone={answer.view.everyone}
          nearMisses={answer.view.nearMisses}
          nearMissesPossible={answer.nearMissesPossible}
          maxMissing={answer.view.maxMissing}
          stale={searching}
          chosen={selected.map((p) => p.id)}
          ontoggle={toggle}
        />
      </div>
    {/if}
    {#if selected.length > 0}
      <div class="bar" role="region" aria-label="Auswahl für eine Abstimmung">
        <span aria-live="polite">{selectionLabel(selected.length)}{selected.length >= MAX_PICKS ? " (mehr geht nicht)" : ""}</span>
        <Button onclick={makePoll}>Abstimmung anlegen</Button>
      </div>
    {/if}
  {/if}
</Page>

<style>
  .bar {
    position: sticky;
    bottom: calc(16px + env(safe-area-inset-bottom, 0px)); /* above Android's gesture bar in the app */
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 8px 8px 20px;
    border-radius: var(--radius-card);
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-primary-container);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.25);
    font-weight: 600;
  }

  .scroll-target {
    scroll-margin-top: 16px;
  }
</style>
