<script lang="ts">
  import { endOptions, instantLabel, startOptions, withStart, type DraftItem } from "../../lib/poll-draft";
  import { berlinToday, formatDay } from "../../lib/gap-search";

  interface Props {
    item: DraftItem;
    /** Marks the proposal the check has complained about. */
    problem?: boolean;
    onchange: (next: DraftItem) => void;
  }

  let { item, problem = false, onchange }: Props = $props();
  const id = $props.id();

  function setStart(value: string): void {
    if (item.kind === "timed") onchange(withStart(item, value));
  }
  function setEnd(value: string): void {
    if (item.kind === "timed") onchange({ ...item, end: value });
  }
  function setFirst(value: string): void {
    if (item.kind === "days") onchange({ ...item, first: value, last: item.last < value ? value : item.last });
  }
  function setLast(value: string): void {
    if (item.kind === "days") onchange({ ...item, last: value });
  }
</script>

<div class="item" class:problem>
  {#if item.kind === "timed"}
    <strong>{formatDay(berlinToday(new Date(item.gap.start)))}, frei {item.label} Uhr</strong>
    <div class="pair">
      <div class="field">
        <label for="{id}-start">Beginn</label>
        <select id="{id}-start" value={item.start} onchange={(e) => setStart(e.currentTarget.value)}>
          {#each startOptions(item.gap) as t (t)}<option value={t}>{instantLabel(t, item.gap.start)}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="{id}-end">Ende</label>
        <select id="{id}-end" value={item.end} onchange={(e) => setEnd(e.currentTarget.value)}>
          {#each endOptions(item.gap, item.start) as t (t)}<option value={t}>{instantLabel(t, item.gap.start)}</option>{/each}
        </select>
      </div>
    </div>
  {:else}
    <strong>Frei: {formatDay(item.gapFirst)} bis {formatDay(item.gapLast)}</strong>
    <div class="pair">
      <div class="field">
        <label for="{id}-first">Erster Tag</label>
        <input id="{id}-first" type="date" min={item.gapFirst} max={item.gapLast} value={item.first} onchange={(e) => setFirst(e.currentTarget.value)} />
      </div>
      <div class="field">
        <label for="{id}-last">Letzter Tag</label>
        <input id="{id}-last" type="date" min={item.first} max={item.gapLast} value={item.last} onchange={(e) => setLast(e.currentTarget.value)} />
      </div>
    </div>
  {/if}
</div>

<style>
  .item {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 16px;
    border-radius: 16px;
    background: var(--md-sys-color-surface);
    color: var(--md-sys-color-on-surface);
  }

  .item.problem {
    outline: 2px solid var(--md-sys-color-error);
  }

  .pair {
    display: flex;
    gap: 12px;
  }

  .field {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--md-sys-color-on-surface-variant);
  }

  select,
  input {
    min-height: 48px;
    width: 100%;
    padding: 0 12px;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: 12px;
    background: var(--md-sys-color-surface);
    color: var(--md-sys-color-on-surface);
    font: inherit;
  }
</style>
