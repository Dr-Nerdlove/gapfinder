<script lang="ts">
  import type { CinemaInfo, CinemaShowing } from "@lueckenfueller/shared";
  import * as api from "../../lib/api";
  import { errorMessage } from "../../lib/messages";
  import { session } from "../../lib/session.svelte";
  import {
    ADVERT_MINUTES_DEFAULT,
    ADVERT_MINUTES_OPTIONS,
    FILM_MINUTES_OPTIONS,
    groupShowings,
    minutesLabel,
    shortSearchHint,
    summaryLines,
    type CheckedShowing,
  } from "../../lib/cinema";
  import {
    checkFilm,
    daysToFetch,
    eveningShowings,
    filmMinutesOf,
    fittingLabel,
    groupFilms,
    knownLength,
    rankFilms,
    runLimited,
    type FilmShowing,
  } from "../../lib/cinema-film";
  import { formatClock, formatDay } from "../../lib/gap-search";
  import type { CinemaSource } from "../../lib/poll-draft";
  import Button from "../Button.svelte";
  import Card from "../Card.svelte";
  import Message from "../Message.svelte";
  import SelectField from "../SelectField.svelte";
  import CinemaEntry from "./CinemaEntry.svelte";

  interface Props {
    source: CinemaSource;
    cinemas: CinemaInfo[];
    /** The showings that fit and are not left out: they become the proposals. */
    chosen?: CheckedShowing[];
    /** True from step 3 on (and in the entry by hand): only then the page offers its submit button. */
    ready?: boolean;
  }

  let { source, cinemas, chosen = $bindable([]), ready = $bindable(false) }: Props = $props();

  let step = $state<1 | 2 | 3>(1);
  let manual = $state(false);
  let ticked = $state<number[]>([]);
  let loading = $state(false);
  let problem = $state("");
  /** Cinema and day that could not be fetched, with the reason. */
  let failures = $state<Failure[]>([]);
  let showings = $state.raw<FilmShowing[]>([]);
  let query = $state("");
  let selectedKey = $state("");
  let leftOut = $state<string[]>([]);
  let film = $state("120");
  let filmTouched = $state(false);
  let advert = $state(String(ADVERT_MINUTES_DEFAULT));
  /** Runtimes by cineamo movie id; filled in as the answers arrive. A failed one stays missing (120 minutes). */
  let runtimes = $state<Record<number, number | undefined>>({});

  // What was fetched stays for the session of this page, so going back and forth costs no request.
  const cache = new Map<string, CinemaShowing[]>();
  const runtimeAsked = new Set<number>();
  /** Movie ids whose answer (or failure) is in. */
  let settled = $state<number[]>([]);

  const days = $derived(daysToFetch(source));
  const lines = $derived(summaryLines(source, days));
  const films = $derived(groupFilms(showings));
  const cards = $derived(rankFilms(films, { source, runtimes, advertMinutes: Number(advert), now: new Date() }, query));
  const selected = $derived(films.find((f) => f.key === selectedKey));
  const tickedCinemas = $derived(cinemas.filter((c) => ticked.includes(c.id)));
  const STEP_NAMES = ["Kinos wählen", "Film wählen", "Vorstellungen"];

  const check = $derived(selected ? checkFilm(selected, { source, filmMinutes: Number(film), advertMinutes: Number(advert), now: new Date() }) : null);
  const groups = $derived(groupShowings(check?.checked ?? []));
  const filmOptions = $derived(
    [...new Set([...FILM_MINUTES_OPTIONS, Number(film)])].sort((a, b) => a - b).map((m) => ({ value: String(m), label: minutesLabel(m) })),
  );
  const advertOptions = ADVERT_MINUTES_OPTIONS.map((m) => ({ value: String(m), label: minutesLabel(m) }));
  const runtime = $derived(selected?.movieId !== undefined ? runtimes[selected.movieId] : undefined);
  const searchHint = $derived(shortSearchHint(source.durationMinutes, Number(film), Number(advert)));

  $effect(() => {
    ready = manual || step === 3;
  });

  $effect(() => {
    if (manual) return;
    chosen = step === 3 && check ? check.checked.filter((s) => s.fits && !leftOut.includes(s.key)) : [];
  });

  // The length follows cineamo's answer until the person changes it.
  $effect(() => {
    if (step === 3 && selected && !filmTouched) film = String(filmMinutesOf(selected, runtimes));
  });

  function toggleCinema(id: number): void {
    ticked = ticked.includes(id) ? ticked.filter((i) => i !== id) : [...ticked, id];
  }

  /** A line for the failure list; `notYet` marks days the cinema has probably not published yet. */
  interface Failure {
    text: string;
    notYet: boolean;
  }

  async function fetchOne(cinema: CinemaInfo, day: string): Promise<Failure | null> {
    try {
      const result = await session.run((o) => api.getCinemaShowings(cinema.id, day, o));
      if (!result.ok) {
        // The server refuses days too far ahead with "validation"; cinemas publish times only 1-2 weeks ahead.
        if (result.kind === "error" && result.code === "validation") return { text: `${cinema.name}, ${formatDay(day)}: noch keine Spielzeiten`, notYet: true };
        return { text: `${cinema.name}, ${formatDay(day)}: ${errorMessage(result)}`, notYet: false };
      }
      cache.set(`${cinema.id}|${day}`, result.data.showings);
      return null;
    } catch {
      return { text: `${cinema.name}, ${formatDay(day)}: Die Spielzeiten konnten nicht geholt werden.`, notYet: false };
    }
  }

  async function showFilms(): Promise<void> {
    if (loading || ticked.length === 0) return;
    problem = "";
    failures = [];
    loading = true;
    const jobs = tickedCinemas.flatMap((c) => days.filter((d) => !cache.has(`${c.id}|${d}`)).map((d) => () => fetchOne(c, d)));
    const results = await runLimited(jobs);
    loading = false;
    const errors = results.filter((r): r is Failure => r !== null);
    const all: FilmShowing[] = tickedCinemas.flatMap((c) => days.flatMap((d) => eveningShowings(c, d, cache.get(`${c.id}|${d}`) ?? [])));
    const gotAny = tickedCinemas.some((c) => days.some((d) => cache.has(`${c.id}|${d}`)));
    if (!gotAny) {
      problem =
        days.length === 0
          ? "In der Suche gibt es keinen Tag, an dem alle frei sind."
          : `Die Spielzeiten konnten nicht geholt werden. ${errors[0]?.text ?? ""} Versuche es später noch einmal oder trage die Zeiten selbst ein.`.trim();
      return;
    }
    failures = errors;
    showings = all;
    if (!films.some((f) => f.key === selectedKey)) selectedKey = "";
    step = 2;
    void fetchRuntimes();
  }

  async function fetchRuntimes(): Promise<void> {
    const ids = [...new Set(films.flatMap((f) => (f.movieId !== undefined ? [f.movieId] : [])))].filter((id) => !runtimeAsked.has(id));
    for (const id of ids) runtimeAsked.add(id);
    await runLimited(
      ids.map((id) => async () => {
        try {
          const result = await session.run((o) => api.cinemaMovie(id, o));
          if (result.ok && result.data.runtime !== undefined && result.data.runtime > 0) runtimes[id] = result.data.runtime;
        } catch {
          // The length stays at the default; the person can change it.
        }
        settled = [...settled, id];
      }),
    );
  }

  function goToShowings(): void {
    if (!selected) return;
    filmTouched = false;
    leftOut = [];
    step = 3;
  }

  function toggleOut(key: string): void {
    leftOut = leftOut.includes(key) ? leftOut.filter((k) => k !== key) : [...leftOut, key];
  }

  const range = (s: CheckedShowing): string => `${formatClock(s.start)} – ${formatClock(s.end)}`;
  const reasonOf = (s: CheckedShowing): string => {
    const room = check?.info.get(s.key)?.room;
    return room ? `${s.reason} · Saal ${room}` : s.reason;
  };
</script>

{#if manual}
  <div><button type="button" class="link" onclick={() => (manual = false)}>Zurück zur Auswahl der Kinos</button></div>
  <CinemaEntry {source} bind:chosen {cinemas} />
{:else}
  <Card title="Kino-Vorschläge">
    {#each lines as line (line)}<p class="hint">{line}</p>{/each}
    <p class="hint">Schritt {step} von 3 · {STEP_NAMES[step - 1]}</p>
  </Card>

  {#if step === 1}
    <Card title="Kinos wählen">
      {#if loading}
        <p class="hint" role="status">Die Spielzeiten werden geholt …</p>
      {:else}
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
        <p class="hint">Die Spielzeiten werden für die Tage mit freien Zeiten geholt ({days.map(formatDay).join(", ") || "keine"}).</p>
        <p class="hint">Test: Diesen Abschnitt sehen nur Admins.</p>
      {/if}
    </Card>
    <Message text={problem} />
    <div class="center">
      <Button full onclick={showFilms} disabled={loading || ticked.length === 0}>
        {loading ? "Wird geholt …" : `Filme anzeigen (${ticked.length} ${ticked.length === 1 ? "Kino" : "Kinos"})`}
      </Button>
      <p class="hint">Spielzeiten: Cineamo</p>
      {#if !loading}<button type="button" class="link" onclick={() => (manual = true)}>Zeiten selbst eintragen</button>{/if}
    </div>
  {:else if step === 2}
    <Card title="Film wählen">
      {#if failures.length > 0}
        <details class="warn">
          <summary>Einige Spielzeiten fehlen ({failures.length})</summary>
          {#if failures.some((f) => f.notYet)}
            <p>Vermutlich haben die Kinos für diese Tage noch keine Spielzeiten veröffentlicht. Das geschieht meist erst ein bis zwei Wochen vorher.</p>
          {/if}
          <p>Diese Spielzeiten konnten nicht geholt werden und fehlen in der Liste:</p>
          <ul>{#each failures as failure (failure.text)}<li>{failure.text}</li>{/each}</ul>
        </details>
      {/if}
      <div class="search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z" /></svg>
        <input type="search" placeholder="Film suchen" aria-label="Film suchen" bind:value={query} onkeydown={(e) => e.key === "Enter" && e.preventDefault()} />
      </div>
      <div class="list">
        {#each cards as card (card.film.key)}
          {@const on = selectedKey === card.film.key}
          {@const length = knownLength(card.film, runtimes)}
          <button type="button" class="showing film" class:fits={on} class:none={card.fitting === 0} aria-pressed={on} onclick={() => (selectedKey = card.film.key)}>
            <span class="text">
              <strong>{card.film.title}</strong>
              {#if card.film.versions.length > 0}
                <span class="tags">{#each card.film.versions as version (version)}<span class="tag">{version}</span>{/each}</span>
              {/if}
              <span class="reason">läuft in {card.cinemaCount} von {ticked.length} Kinos{length ? ` · ${length}` : ""}</span>
              {#if card.fitting > 0}
                <span class="count">{fittingLabel(card.fitting)}</span>
              {:else}
                <span class="reason">keine passt in eure freien Zeiten</span>
              {/if}
            </span>
            {#if on}<span class="chip ok">✓ gewählt</span>{/if}
          </button>
        {:else}
          <p class="hint">{query.trim() === "" ? "Cineamo kennt für diese Kinos und Tage keine Vorstellungen." : "Kein Film passt zu deiner Suche."}</p>
        {/each}
      </div>
      <p class="hint">Spielzeiten: Cineamo</p>
    </Card>
    <div class="center">
      <Button full onclick={goToShowings} disabled={!selected}>{selected ? `Weiter mit „${selected.title}“` : "Weiter"}</Button>
      <button type="button" class="link" onclick={() => (step = 1)}>Anderes Kino wählen</button>
    </div>
  {:else if selected}
    <Card title={selected.title}>
      <div class="pair">
        <SelectField label="Filmlänge" bind:value={film} options={filmOptions} onchange={() => (filmTouched = true)} />
        <SelectField label="Werbepuffer" bind:value={advert} options={advertOptions} />
      </div>
      <p class="hint">
        {#if runtime !== undefined}
          {runtime} Min. (von Cineamo), du kannst die Länge ändern.
        {:else if selected.movieId !== undefined && !settled.includes(selected.movieId)}
          Die Länge wird bei Cineamo geholt …
        {:else}
          120 Min. angenommen, Cineamo kennt die Länge nicht. Du kannst die Länge ändern.
        {/if}
        Der Werbepuffer ist die Zeit für Werbung und Trailer vor dem Film.
      </p>
      {#if searchHint}<p class="hint warn">{searchHint}</p>{/if}
      <div><button type="button" class="link" onclick={() => (step = 2)}>Anderen Film wählen</button></div>
    </Card>

    <Card title="Passt in eure freien Zeiten?">
      {#each groups as group (group.key)}
        <h3>{formatDay(group.day)}, {group.place}</h3>
        {#each group.items as s (s.key)}
          {@const chip = check?.info.get(s.key)?.chip}
          {#if s.fits}
            {@const on = !leftOut.includes(s.key)}
            <button type="button" class="showing fits" class:off={!on} aria-pressed={on} onclick={() => toggleOut(s.key)}>
              <span class="text">
                <span class="head"><strong>{range(s)}</strong>{#if chip}<span class="tag">{chip}</span>{/if}</span>
                <span class="reason">{reasonOf(s)}</span>
              </span>
              <span class="chip" class:ok={on}>{on ? "✓ passt" : "weggelassen"}</span>
            </button>
          {:else}
            <div class="showing no">
              <span class="text">
                <span class="head"><strong>{range(s)}</strong>{#if chip}<span class="tag">{chip}</span>{/if}</span>
                <span class="reason">{reasonOf(s)}</span>
              </span>
              <span class="chip bad">✕ passt nicht</span>
            </div>
          {/if}
        {/each}
      {/each}
      <p class="hint">
        Zeiten inklusive {advert} Min. Werbepuffer. Nur die passenden Vorstellungen werden zu Terminen der Abstimmung. Tippe auf eine passende Vorstellung, um sie wegzulassen.
      </p>
      <p class="hint">Spielzeiten: Cineamo</p>
    </Card>
  {/if}
{/if}

<style>
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

  .warn {
    padding: 8px 12px;
    border-radius: 12px;
    background: var(--md-sys-color-secondary-container);
    color: var(--md-sys-color-on-secondary-container);
    font-size: 0.875rem;
  }

  .warn summary {
    min-height: 32px;
    display: flex;
    align-items: center;
    font-weight: 600;
    cursor: pointer;
  }

  .warn[open] summary {
    margin-bottom: 4px;
  }

  .warn p {
    margin: 0 0 4px;
  }

  .warn ul {
    margin: 4px 0 0;
    padding-left: 20px;
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

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: 12px;
    background: var(--md-sys-color-surface);
    color: var(--md-sys-color-on-surface-variant);
  }

  .search input {
    flex: 1;
    min-width: 0;
    min-height: 48px;
    border: 0;
    background: transparent;
    color: var(--md-sys-color-on-surface);
    font: inherit;
  }

  .search input:focus {
    outline: none;
  }

  .search:focus-within {
    outline: 2px solid var(--md-sys-color-primary);
  }

  .pair {
    display: flex;
    gap: 12px;
  }

  h3 {
    margin: 4px 0 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--md-sys-color-on-surface-variant);
  }

  .showing {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    min-height: 48px;
    padding: 10px 14px;
    border: 2px solid var(--md-sys-color-outline-variant);
    border-radius: 16px;
    background: var(--md-sys-color-surface);
    color: var(--md-sys-color-on-surface);
    font: inherit;
    text-align: left;
  }

  button.showing {
    cursor: pointer;
  }

  .showing.fits:not(.off) {
    border-color: var(--md-sys-color-primary);
  }

  .showing.no,
  .showing.none {
    border-style: dashed;
    border-width: 1px;
    border-color: var(--md-sys-color-outline);
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
  }

  .showing.none.fits {
    border-style: solid;
    border-width: 2px;
    border-color: var(--md-sys-color-primary);
  }

  .text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    min-width: 0;
  }

  .text strong {
    overflow-wrap: anywhere;
  }

  .head,
  .tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .tag {
    padding: 0 8px;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: 999px;
    font-size: 0.75rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .reason {
    font-size: 0.8125rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .count {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--md-sys-color-primary);
  }

  .chip {
    flex: none;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 0.8125rem;
    font-weight: 600;
    background: var(--md-sys-color-surface-variant);
    color: var(--md-sys-color-on-surface-variant);
  }

  .chip.ok {
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-primary-container);
  }

  .chip.bad {
    background: var(--md-sys-color-error-container);
    color: var(--md-sys-color-on-error-container);
  }
</style>
