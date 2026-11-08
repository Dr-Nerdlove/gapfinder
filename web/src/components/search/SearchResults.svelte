<script lang="ts">
  import { NEAR_MISS_MIN_PEOPLE } from "@lueckenfueller/shared";
  import type { PollPick, Row } from "../../lib/gap-search";
  import Button from "../Button.svelte";
  import Card from "../Card.svelte";
  import Chip from "../Chip.svelte";

  interface Props {
    summary: string;
    /** One text per person who was left out. */
    notices: string[];
    everyone: Row[];
    nearMisses: Row[];
    /** At least `NEAR_MISS_MIN_PEOPLE` people could be read. */
    nearMissesPossible: boolean;
    /** The most people who may be missing from a line of `nearMisses`. */
    maxMissing: number;
    /** The last answer is shown while a new search is running. */
    stale: boolean;
    /** The ids of the free times chosen for a poll. */
    chosen: string[];
    ontoggle: (pick: PollPick) => void;
  }

  let { summary, notices, everyone, nearMisses, nearMissesPossible, maxMissing, stale, chosen, ontoggle }: Props = $props();

  const STEP = 10;
  let everyoneShown = $state(STEP);
  let nearShown = $state(STEP);
</script>

{#snippet picks(row: Row)}
  <span class="picks">
    {#each row.picks as pick (pick.id)}
      <Chip
        label={pick.kind === "timed" ? pick.label : `${pick.label} vorschlagen`}
        selected={chosen.includes(pick.id)}
        onclick={() => ontoggle(pick)}
      />
    {/each}
  </span>
{/snippet}

<div class="results" class:stale aria-live="polite">
  <Card title="Ergebnis">
    <p class="summary">{summary}</p>
  </Card>

  {#if notices.length > 0}
    <Card tone="notice" title="Nicht berücksichtigt">
      <ul class="plain">
        {#each notices as notice (notice)}<li>{notice}</li>{/each}
      </ul>
    </Card>
  {/if}

  <p class="hint">Tippe auf Zeiten, die du als Termine zur Abstimmung vorschlagen willst.</p>

  <Card title="Alle frei">
    {#if everyone.length === 0}
      <p>Keine Lücke gefunden, in der alle Zeit haben.</p>
    {:else}
      <ul class="rows">
        {#each everyone.slice(0, everyoneShown) as row (row.key)}
          <li>
            <strong>{row.heading}</strong>
            <span class="detail">
              {#if row.picks[0]?.kind === "timed"}{@render picks(row)}{:else}{row.detail}{@render picks(row)}{/if}
              {#if row.extra}<span class="extra">{row.extra}</span>{/if}
            </span>
          </li>
        {/each}
      </ul>
      {#if everyone.length > everyoneShown}
        <div><Button variant="tonal" onclick={() => (everyoneShown += STEP)}>Mehr anzeigen ({everyone.length - everyoneShown} weitere)</Button></div>
      {/if}
    {/if}
  </Card>

  <Card title="Fast alle">
    {#if !nearMissesPossible}
      <p>Diese Liste gibt es erst, wenn mindestens {NEAR_MISS_MIN_PEOPLE} Personen gesucht werden können.</p>
    {:else if nearMisses.length === 0}
      <p>
        {maxMissing === 1
          ? "Keine Lücke gefunden, in der nur eine Person fehlt."
          : `Keine Lücke gefunden, in der höchstens ${maxMissing} Personen fehlen.`}
      </p>
    {:else}
      <ul class="rows">
        {#each nearMisses.slice(0, nearShown) as row (row.key)}
          <li class="near">
            <strong>{row.heading}</strong>
            <span class="detail">
              <span class="count">{row.count}</span>
              <span class="missing">{row.missing}</span>
              {#if row.picks[0]?.kind !== "timed"}{row.detail}{/if}
            </span>
            <span class="below">
              {@render picks(row)}
              {#if row.extra}<span class="extra">{row.extra}</span>{/if}
            </span>
          </li>
        {/each}
      </ul>
      {#if nearMisses.length > nearShown}
        <div><Button variant="tonal" onclick={() => (nearShown += STEP)}>Mehr anzeigen ({nearMisses.length - nearShown} weitere)</Button></div>
      {/if}
    {/if}
  </Card>
</div>

<style>
  .results {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .results.stale {
    opacity: 0.5;
  }

  .hint {
    font-size: 0.9375rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .summary {
    font-size: 0.9375rem;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .plain {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .rows {
    display: flex;
    flex-direction: column;
  }

  .rows li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0;
    border-top: 1px solid var(--md-sys-color-outline-variant);
  }

  .rows li.near {
    flex-wrap: wrap;
    gap: 8px 12px;
  }

  .below {
    flex-basis: 100%;
    text-align: right;
  }

  .rows li:first-child {
    border-top: 0;
    padding-top: 0;
  }

  strong {
    flex: none;
    color: var(--md-sys-color-on-surface);
  }

  .detail {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    text-align: right;
  }

  .count {
    font-weight: 500;
    color: var(--md-sys-color-on-surface);
  }

  .missing {
    color: var(--md-sys-color-on-surface-variant);
  }

  .picks {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  .extra {
    display: block;
    font-size: 0.875rem;
  }
</style>
