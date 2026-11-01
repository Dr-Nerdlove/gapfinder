<script lang="ts">
  import type { Calendar, CalendarPreview } from "@lueckenfueller/shared";
  import { untrack } from "svelte";
  import * as api from "../../lib/api";
  import { errorMessage } from "../../lib/messages";
  import { previewDays, problemNotices } from "../../lib/preview";
  import { session } from "../../lib/session.svelte";
  import Button from "../Button.svelte";
  import Card from "../Card.svelte";
  import Message from "../Message.svelte";

  interface Props {
    calendars: Calendar[];
    /** Raised whenever the events may have changed (calendar added, switched, relinked, removed): loads again. */
    version: number;
    locked: boolean;
    /** The person wants to enter the link of a calendar again. */
    onrelink: (calendarId: number) => void;
  }

  let { calendars, version, locked, onrelink }: Props = $props();

  let preview = $state<CalendarPreview | null>(null);
  let loading = $state(true);
  let error = $state("");
  let latest = 0;

  async function load(): Promise<void> {
    const mine = ++latest;
    loading = true;
    error = "";
    const result = await session.run((o) => api.getCalendarPreview(o));
    // An older answer must not replace a newer one.
    if (mine !== latest) return;
    loading = false;
    if (result.ok) preview = result.data;
    else if (result.kind === "error") error = errorMessage(result);
    // Offline: the notice of the page explains it; the last preview stays.
  }

  $effect(() => {
    void version;
    untrack(() => void load());
  });

  const names = $derived(new Map(calendars.map((calendar) => [calendar.id, calendar.name])));
  const days = $derived(preview ? previewDays(preview) : []);
  const notices = $derived(preview ? problemNotices(preview.problems, calendars) : []);
</script>

<Card title="Deine nächsten 4 Wochen">
  {#if error}
    <Message text={error} />
  {/if}

  {#each notices as notice (notice.calendarId)}
    <div class="problem" role="alert">
      <p>{notice.text}</p>
      {#if notice.problem === "broken"}
        <Button variant="tonal" disabled={locked} onclick={() => onrelink(notice.calendarId)}>Link neu eintragen</Button>
      {/if}
    </div>
  {/each}

  {#if loading && !preview}
    <p aria-live="polite">Kalender werden gelesen …</p>
  {:else if preview && days.length === 0}
    <p>In den nächsten 4 Wochen ist nichts eingetragen.</p>
  {/if}

  {#if days.length > 0}
    <div class="days" class:stale={loading}>
      {#each days as day (day.key)}
        <section>
          <h3>{day.heading}</h3>
          <ul>
            {#each day.entries as entry, index (index)}
              <li class:off={!entry.countsAsBusy}>
                <span class="time">{entry.timeLabel}</span>
                <span class="what">
                  <span class="title">{entry.title}</span>
                  <span class="calendar">{names.get(entry.calendarId) ?? ""}{#if !entry.countsAsBusy}{" · zählt nicht"}{/if}</span>
                </span>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/if}

  <div class="reload">
    <Button variant="tonal" disabled={loading || locked} onclick={load}>
      {loading ? "Lädt …" : "Neu laden"}
    </Button>
    {#if loading && preview}<span aria-live="polite">Kalender werden gelesen …</span>{/if}
  </div>
</Card>

<style>
  .problem {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 12px 16px;
    border-radius: 16px;
    background: var(--md-sys-color-error-container);
    color: var(--md-sys-color-on-error-container);
    font-weight: 500;
  }

  .days {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .days.stale {
    opacity: 0.6;
  }

  h3 {
    margin: 0 0 4px;
    font-size: 1rem;
    font-weight: 600;
    color: var(--md-sys-color-primary);
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: grid;
    grid-template-columns: 7.5rem 1fr;
    gap: 12px;
    color: var(--md-sys-color-on-surface);
  }

  .time {
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }

  .what {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .title {
    overflow-wrap: anywhere;
  }

  .calendar {
    font-size: 0.875rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  li.off {
    opacity: 0.6;
  }

  li.off .title {
    font-style: italic;
  }

  .reload {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }
</style>
