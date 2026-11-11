<script lang="ts">
  import type { SearchResult } from "@lueckenfueller/shared";
  import { cellText, dayCounts, dayStrip, hourText, monthGrid, rowsOfDay, searchMonths, windowLine, type SearchedDays } from "../../lib/colour-grid";
  import { formatDay, monthLabelShort, type PollPick, type Row } from "../../lib/gap-search";
  import Chip from "../Chip.svelte";

  interface Props {
    result: SearchResult;
    /** How many people could be searched. */
    readable: number;
    searched: SearchedDays;
    window: { start: string; end: string };
    everyone: Row[];
    nearMisses: Row[];
    chosen: string[];
    ontoggle: (pick: PollPick) => void;
  }

  let { result, readable, searched, window, everyone, nearMisses, chosen, ontoggle }: Props = $props();

  const months = $derived(searchMonths(searched));
  const counts = $derived(dayCounts(result, readable));
  let monthIndex = $state(0);
  let day = $state<string | null>(null);

  // A new answer starts at its first month with nothing opened.
  $effect(() => {
    void result;
    monthIndex = 0;
    day = null;
  });

  const month = $derived(months[Math.min(monthIndex, months.length - 1)] ?? searched.from.slice(0, 7));
  const weeks = $derived(monthGrid(month, searched, counts, readable));
  const strip = $derived(day ? dayStrip(result, day, readable, window) : []);
  const line = $derived(windowLine(strip, window));
  const everyoneOfDay = $derived(day ? rowsOfDay(everyone, day) : []);
  const nearOfDay = $derived(day ? rowsOfDay(nearMisses, day) : []);
  const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
</script>

{#snippet picks(row: Row)}
  <span class="picks">
    {#each row.picks as pick (pick.id)}
      <Chip label="Als Termin vorschlagen" selected={chosen.includes(pick.id)} onclick={() => ontoggle(pick)} />
    {/each}
  </span>
{/snippet}

<div class="grid">
  <div class="nav">
    <button type="button" aria-label="Vorheriger Monat" disabled={monthIndex === 0} onclick={() => (monthIndex -= 1)}>‹</button>
    <strong aria-live="polite">{monthLabelShort(month)}</strong>
    <button type="button" aria-label="Nächster Monat" disabled={monthIndex >= months.length - 1} onclick={() => (monthIndex += 1)}>›</button>
  </div>

  <table aria-label="Monatsraster der Suche">
    <thead>
      <tr>{#each WEEKDAYS as name (name)}<th scope="col">{name}</th>{/each}</tr>
    </thead>
    <tbody>
      {#each weeks as week, i (i)}
        <tr>
          {#each week as cell, j (j)}
            <td>
              {#if cell === null}
                <!-- empty -->
              {:else if !cell.searched}
                <span class="cell off"><span class="n">{cell.day}</span></span>
              {:else}
                <button
                  type="button"
                  class="cell shade{cell.shade}"
                  class:open={day === cell.date}
                  class:empty={cell.count === null}
                  aria-pressed={day === cell.date}
                  aria-label={`${formatDay(cell.date)}: ${cell.count === null ? "keine Lücke" : cell.count >= readable ? "alle können" : `${cell.count} von ${readable} können`}`}
                  onclick={() => (day = day === cell.date ? null : cell.date)}
                >
                  <span class="n">{cell.day}</span>
                  <span class="c">{cellText(cell.count, readable)}</span>
                </button>
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>

  <div class="legend" aria-hidden="true">
    <span>weniger</span>
    {#each [0, 1, 2, 3, 4] as step (step)}<span class="step shade{step}"></span>{/each}
    <span>alle frei</span>
  </div>

  {#if day}
    <section class="day" aria-label={`Details für ${formatDay(day)}`}>
      <h3>{formatDay(day)}</h3>
      {#if strip.length > 0}
        <div class="strip" aria-hidden="true" style:--cols={strip.length}>
          {#each strip as hour (hour.hour)}
            <span class="hl">{hour.hour}</span>
          {/each}
          {#each strip as hour (hour.hour)}
            <span class="hc shade{hour.shade}" class:empty={hour.count === null}>{hourText(hour.count, readable)}</span>
          {/each}
          {#if line}<span class="win" style:grid-column="{line.start} / {line.end}">{line.text}</span>{/if}
        </div>
      {/if}
      {#if everyoneOfDay.length === 0 && nearOfDay.length === 0}
        <p>An diesem Tag gibt es keine Lücke, die für viele passt.</p>
      {/if}
      <ul class="lines">
        {#each everyoneOfDay as row (row.key)}
          <li>
            <strong>{row.picks[0]?.kind === "timed" ? row.detail : row.heading}</strong>
            <span class="who">alle können</span>
            {@render picks(row)}
          </li>
        {/each}
        {#each nearOfDay as row (row.key)}
          <li>
            <strong>{row.picks[0]?.kind === "timed" ? row.detail : row.heading}</strong>
            <span class="who">{row.count}{row.missing ? ` – ${row.missing}` : ""}</span>
            {@render picks(row)}
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .grid {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .nav strong {
    font-size: 1rem;
  }

  .nav button {
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 50%;
    background: transparent;
    color: var(--md-sys-color-on-surface);
    font-size: 1.25rem;
    line-height: 1;
    cursor: pointer;
  }

  .nav button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 4px;
    table-layout: fixed;
  }

  th {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--md-sys-color-on-surface-variant);
  }

  td {
    padding: 0;
  }

  /* Shades are the primary colour with growing opacity over the card, so they look right in light and dark and with any seed colour.
     The number (or the missing number in the strip) is the other sign; the darkest shade means everybody. */
  .shade4 {
    --fill: var(--md-sys-color-primary);
    --ink: var(--md-sys-color-on-primary);
  }

  .shade3 {
    --fill: color-mix(in srgb, var(--md-sys-color-primary) 75%, transparent);
    --ink: var(--md-sys-color-on-primary);
  }

  .shade2 {
    --fill: color-mix(in srgb, var(--md-sys-color-primary) 55%, transparent);
    --ink: var(--md-sys-color-on-surface);
  }

  .shade1 {
    --fill: color-mix(in srgb, var(--md-sys-color-primary) 35%, transparent);
    --ink: var(--md-sys-color-on-surface);
  }

  .shade0 {
    --fill: color-mix(in srgb, var(--md-sys-color-primary) 18%, transparent);
    --ink: var(--md-sys-color-on-surface);
  }

  /* In dark mode the primary colour is light: the middle shades stay darker so the light numbers keep their contrast. */
  @media (prefers-color-scheme: dark) {
    .shade2 {
      --fill: color-mix(in srgb, var(--md-sys-color-primary) 36%, transparent);
    }

    .shade1 {
      --fill: color-mix(in srgb, var(--md-sys-color-primary) 24%, transparent);
    }

    .shade0 {
      --fill: color-mix(in srgb, var(--md-sys-color-primary) 14%, transparent);
    }
  }

  .cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    aspect-ratio: 1;
    min-height: 36px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 8px;
    background: var(--fill);
    color: var(--ink);
    font: inherit;
    line-height: 1.1;
  }

  /* Searched but nothing found: no fill, only an outline. */
  .cell.empty,
  .hc.empty {
    --fill: transparent;
    --ink: var(--md-sys-color-on-surface-variant);
    border-color: var(--md-sys-color-outline-variant);
  }

  button.cell {
    cursor: pointer;
  }

  button.cell.open {
    box-shadow: 0 0 0 2px var(--md-sys-color-on-surface);
  }

  /* Outside the search: no background, only the faint day number. */
  .cell.off {
    background: none;
    color: var(--md-sys-color-on-surface-variant);
    opacity: 0.55;
  }

  .n {
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .c {
    font-size: 0.6875rem;
    font-weight: 600;
  }

  .legend {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.75rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .step {
    width: 14px;
    height: 14px;
    border-radius: 4px;
    background: var(--fill);
  }

  .step:first-of-type {
    margin-left: 2px;
  }

  .day {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-radius: 16px;
    background: var(--md-sys-color-surface);
  }

  h3 {
    margin: 0;
    font-size: 1rem;
  }

  /* One grid for the hour numbers, the squares and the window line, so all three share the columns. */
  .strip {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    column-gap: 2px;
    row-gap: 3px;
  }

  .hl {
    font-size: 0.6875rem;
    text-align: center;
    color: var(--md-sys-color-on-surface-variant);
  }

  .hc {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 28px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: var(--fill);
    color: var(--ink);
    font-size: 0.6875rem;
    font-weight: 600;
  }

  .win {
    padding-top: 2px;
    border-top: 2px solid var(--md-sys-color-on-surface-variant);
    font-size: 0.6875rem;
    font-weight: 600;
    text-align: center;
    white-space: nowrap;
    color: var(--md-sys-color-on-surface);
  }

  .lines {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .lines li {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 10px 0;
    border-top: 1px solid var(--md-sys-color-outline-variant);
  }

  .lines li:first-child {
    border-top: 0;
    padding-top: 0;
  }

  .lines strong {
    font-size: 1rem;
  }

  .who {
    font-size: 0.9375rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .picks {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 6px;
  }
</style>
