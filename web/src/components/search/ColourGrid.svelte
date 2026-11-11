<script lang="ts">
  import type { SearchResult } from "@lueckenfueller/shared";
  import { cellText, dayCounts, dayStrip, monthGrid, rowsOfDay, searchMonths, type SearchedDays } from "../../lib/colour-grid";
  import { formatDay, monthLabel, type PollPick, type Row } from "../../lib/gap-search";
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
    <strong aria-live="polite">{monthLabel(month)}</strong>
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
    <span class="bar"></span>
    <span>alle frei</span>
  </div>

  {#if day}
    <section class="day" aria-label={`Details für ${formatDay(day)}`}>
      <h3>{formatDay(day)}</h3>
      {#if strip.length > 0}
        <ol class="strip" aria-hidden="true">
          {#each strip as hour (hour.hour)}
            <li class="shade{hour.shade}" class:empty={hour.count === null} class:inwin={hour.inWindow}>
              <span>{hour.hour}</span>
            </li>
          {/each}
        </ol>
      {/if}
      {#if everyoneOfDay.length === 0 && nearOfDay.length === 0}
        <p>An diesem Tag gibt es keine Lücke, die für viele passt.</p>
      {/if}
      <ul class="lines">
        {#each everyoneOfDay as row (row.key)}
          <li>
            <span><strong>{row.picks[0]?.kind === "timed" ? row.detail : row.heading}</strong> – alle können</span>
            {@render picks(row)}
          </li>
        {/each}
        {#each nearOfDay as row (row.key)}
          <li>
            <span><strong>{row.picks[0]?.kind === "timed" ? row.detail : row.heading}</strong> – {row.count} – {row.missing}</span>
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
    gap: 12px;
  }

  .nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .nav button {
    min-width: 48px;
    min-height: 48px;
    border: 0;
    border-radius: 24px;
    background: var(--md-sys-color-secondary-container);
    color: var(--md-sys-color-on-secondary-container);
    font-size: 1.5rem;
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
    font-weight: 600;
    color: var(--md-sys-color-on-surface-variant);
  }

  td {
    padding: 0;
  }

  /* Shades step from the surface up to the full primary colour; the number or "alle" is the other sign. */
  .shade4 {
    --fill: var(--md-sys-color-primary);
    --ink: var(--md-sys-color-on-primary);
  }

  .shade3 {
    --fill: color-mix(in srgb, var(--md-sys-color-primary) 70%, var(--md-sys-color-surface));
    --ink: var(--md-sys-color-on-primary);
  }

  .shade2 {
    --fill: color-mix(in srgb, var(--md-sys-color-primary) 45%, var(--md-sys-color-surface));
    --ink: var(--md-sys-color-on-surface);
  }

  .shade1 {
    --fill: color-mix(in srgb, var(--md-sys-color-primary) 22%, var(--md-sys-color-surface));
    --ink: var(--md-sys-color-on-surface);
  }

  .shade0 {
    --fill: color-mix(in srgb, var(--md-sys-color-primary) 8%, var(--md-sys-color-surface));
    --ink: var(--md-sys-color-on-surface-variant);
  }

  .cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    aspect-ratio: 1;
    min-height: 44px;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 10px;
    background: var(--fill);
    color: var(--ink);
    font: inherit;
    line-height: 1.1;
  }

  button.cell {
    cursor: pointer;
  }

  button.cell.open {
    border-color: var(--md-sys-color-on-surface);
  }

  .cell.off {
    background: var(--md-sys-color-surface-variant, #e7e0ec);
    opacity: 0.45;
  }

  .n {
    font-size: 0.8125rem;
  }

  .c {
    font-size: 0.75rem;
    font-weight: 700;
  }

  .legend {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.75rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .bar {
    flex: 1;
    height: 10px;
    border-radius: 5px;
    background: linear-gradient(to right, color-mix(in srgb, var(--md-sys-color-primary) 8%, var(--md-sys-color-surface)), var(--md-sys-color-primary));
  }

  .day {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--md-sys-color-outline-variant);
  }

  h3 {
    margin: 0;
    font-size: 1rem;
  }

  .strip {
    display: flex;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .strip li {
    flex: 1;
    padding: 6px 0 4px;
    border-radius: 4px;
    background: var(--fill);
    color: var(--ink);
    font-size: 0.6875rem;
    text-align: center;
    border-bottom: 3px solid transparent;
  }

  .strip li.inwin {
    border-bottom-color: var(--md-sys-color-on-surface);
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
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
    padding: 8px 0;
    border-top: 1px solid var(--md-sys-color-outline-variant);
  }

  .lines li:first-child {
    border-top: 0;
  }

  .picks {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
