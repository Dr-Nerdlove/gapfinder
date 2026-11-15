<script lang="ts">
  import { PROPOSAL_PLACE_MAX_LENGTH } from "@lueckenfueller/shared";
  import { untrack } from "svelte";
  import {
    ADVERT_MINUTES_DEFAULT,
    ADVERT_MINUTES_OPTIONS,
    FILM_MINUTES_DEFAULT,
    FILM_MINUTES_OPTIONS,
    checkShowings,
    defaultCinemaDay,
    groupShowings,
    minutesLabel,
    parseShowtimes,
    shortSearchHint,
    summaryLines,
    type CheckedShowing,
  } from "../../lib/cinema";
  import { formatClock, formatDay } from "../../lib/gap-search";
  import type { CinemaSource } from "../../lib/poll-draft";
  import Button from "../Button.svelte";
  import Card from "../Card.svelte";
  import SelectField from "../SelectField.svelte";
  import TextField from "../TextField.svelte";

  interface Props {
    source: CinemaSource;
    /** The showings that fit and are not left out: they become the proposals. */
    chosen?: CheckedShowing[];
  }

  let { source, chosen = $bindable([]) }: Props = $props();

  interface Block {
    id: number;
    place: string;
    day: string;
    text: string;
    time: string;
  }

  let nextId = 1;
  let blocks = $state<Block[]>([{ id: nextId++, place: "", day: untrack(() => defaultCinemaDay(source)), text: "", time: "" }]);
  let film = $state(String(FILM_MINUTES_DEFAULT));
  let advert = $state(String(ADVERT_MINUTES_DEFAULT));
  let leftOut = $state<string[]>([]);

  const filmOptions = FILM_MINUTES_OPTIONS.map((m) => ({ value: String(m), label: minutesLabel(m) }));
  const advertOptions = ADVERT_MINUTES_OPTIONS.map((m) => ({ value: String(m), label: minutesLabel(m) }));

  const showings = $derived(
    checkShowings(
      blocks.flatMap((b) => parseShowtimes(b.text).map((clock) => ({ place: b.place, day: b.day, clock }))),
      { source, filmMinutes: Number(film), advertMinutes: Number(advert), now: new Date() },
    ),
  );
  const groups = $derived(groupShowings(showings));
  const lines = $derived(summaryLines(source, blocks.filter((b) => b.day !== "").map((b) => b.day)));
  const hint = $derived(shortSearchHint(source.durationMinutes, Number(film), Number(advert)));
  $effect(() => {
    chosen = showings.filter((s) => s.fits && !leftOut.includes(s.key));
  });

  function addTime(block: Block): void {
    const [time] = parseShowtimes(block.time);
    if (time === undefined) return;
    block.text = block.text.trim() === "" ? time : `${block.text.trimEnd()} ${time}`;
    block.time = "";
  }

  function addBlock(): void {
    const last = blocks[blocks.length - 1];
    blocks.push({ id: nextId++, place: last?.place ?? "", day: last?.day ?? defaultCinemaDay(source), text: "", time: "" });
  }

  function toggle(key: string): void {
    leftOut = leftOut.includes(key) ? leftOut.filter((k) => k !== key) : [...leftOut, key];
  }

  const range = (s: CheckedShowing): string => `${formatClock(s.start)} – ${formatClock(s.end)}`;
</script>

<Card title="Kino-Vorschläge">
  {#each blocks as block, index (block.id)}
    <div class="block">
      <TextField label="Kino (Ort)" bind:value={block.place} maxlength={PROPOSAL_PLACE_MAX_LENGTH} />
      <div class="field">
        <label for="day-{block.id}">Tag</label>
        <input id="day-{block.id}" type="date" min={source.from} max={source.to} bind:value={block.day} />
      </div>
      <div class="field">
        <label for="times-{block.id}">Zeiten einfügen</label>
        <textarea id="times-{block.id}" rows="3" placeholder="17:30 20:15 22:45" aria-describedby="times-{block.id}-hint" bind:value={block.text}></textarea>
        <p id="times-{block.id}-hint" class="hint">
          Zum Beispiel von kinoheld oder cineamo kopiert. Du kannst die Zeiten mit Leerzeichen, Komma oder Zeilenumbruch trennen.
        </p>
      </div>
      <div class="single">
        <div class="field grow">
          <label for="time-{block.id}">Einzelne Uhrzeit</label>
          <input id="time-{block.id}" type="time" bind:value={block.time} />
        </div>
        <Button variant="tonal" onclick={() => addTime(block)} disabled={block.time === ""}>Hinzufügen</Button>
      </div>
      {#if index > 0}
        <div><Button variant="outlined" onclick={() => blocks.splice(index, 1)}>Entfernen</Button></div>
      {/if}
    </div>
  {/each}
  <div><Button variant="outlined" onclick={addBlock}>Weiteres Kino oder weiterer Tag</Button></div>

  <div class="pair">
    <SelectField label="Filmlänge" bind:value={film} options={filmOptions} />
    <SelectField label="Werbepuffer" bind:value={advert} options={advertOptions} />
  </div>
  <p class="hint">Der Werbepuffer ist die Zeit für Werbung und Trailer vor dem Film. Vorschlag: 20 Minuten.</p>
  {#if hint}<p class="hint warn">{hint}</p>{/if}
</Card>

<Card title="Passt in eure freien Zeiten?">
  {#each lines as line (line)}<p class="hint">{line}</p>{/each}
  {#each groups as group (group.key)}
    {#if groups.length > 1}<h3>{formatDay(group.day)}{group.place !== "" ? `, ${group.place}` : ""}</h3>{/if}
    {#each group.items as s (s.key)}
      {#if s.fits}
        {@const on = !leftOut.includes(s.key)}
        <button type="button" class="showing fits" class:off={!on} aria-pressed={on} onclick={() => toggle(s.key)}>
          <span class="text"><strong>{range(s)}</strong><span class="reason">{s.reason}</span></span>
          <span class="chip" class:ok={on}>{on ? "✓ passt" : "weggelassen"}</span>
        </button>
      {:else}
        <div class="showing no">
          <span class="text"><strong>{range(s)}</strong><span class="reason">{s.reason}</span></span>
          <span class="chip bad">✕ passt nicht</span>
        </div>
      {/if}
    {/each}
  {/each}
  <p class="hint">Nur die passenden Vorstellungen werden zu Terminen der Abstimmung.</p>
</Card>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .block + .block {
    padding-top: 12px;
    border-top: 1px solid var(--md-sys-color-outline-variant);
  }

  .field {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 4px;
  }

  .grow {
    flex: 1 1 0;
  }

  label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--md-sys-color-on-surface-variant);
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

  .single {
    display: flex;
    align-items: flex-end;
    gap: 12px;
  }

  .pair {
    display: flex;
    gap: 12px;
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

  .showing.no {
    border-style: dashed;
    border-width: 1px;
    border-color: var(--md-sys-color-outline);
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .reason {
    font-size: 0.8125rem;
    color: var(--md-sys-color-on-surface-variant);
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
