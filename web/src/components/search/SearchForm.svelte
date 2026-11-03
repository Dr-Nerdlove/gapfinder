<script lang="ts">
  import {
    SEARCH_MAX_BUFFER_MINUTES,
    SEARCH_MAX_DURATION_MINUTES,
    SEARCH_MAX_PERIOD_DAYS,
    type Person,
    type Weekday,
  } from "@lueckenfueller/shared";
  import {
    ALL_WEEKDAYS,
    RANGE_LABELS,
    WEEKDAY_LABELS,
    durationLabel,
    monthOptions,
    windowMinutes,
    type RangePreset,
    type SearchSettings,
  } from "../../lib/gap-search";
  import Button from "../Button.svelte";
  import Card from "../Card.svelte";
  import Chip from "../Chip.svelte";
  import Message from "../Message.svelte";
  import SelectField from "../SelectField.svelte";

  interface Props {
    settings: SearchSettings;
    /** Everyone with an account except the searcher. */
    others: Person[];
    today: string;
    searching: boolean;
    /** The server is asleep: nothing can be searched. */
    locked: boolean;
    problem: string;
    onsearch: () => void;
  }

  let { settings = $bindable(), others, today, searching, locked, problem, onsearch }: Props = $props();

  const durations = Array.from({ length: SEARCH_MAX_DURATION_MINUTES / 30 }, (_, i) => {
    const minutes = (i + 1) * 30;
    return { value: String(minutes), label: durationLabel(minutes) };
  });
  const clocks = Array.from({ length: 96 }, (_, i) => {
    const value = `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`;
    return { value, label: `${value} Uhr` };
  });
  const buffers = Array.from({ length: SEARCH_MAX_BUFFER_MINUTES / 15 + 1 }, (_, i) => {
    const minutes = i * 15;
    return { value: String(minutes), label: minutes === 0 ? "Keiner" : durationLabel(minutes) };
  });
  const dayCounts = Array.from({ length: SEARCH_MAX_PERIOD_DAYS }, (_, i) => ({
    value: String(i + 1),
    label: i === 0 ? "1 Tag" : `${i + 1} Tage`,
  }));
  const startDays = [
    { value: "", label: "Egal" },
    ...ALL_WEEKDAYS.map((day) => ({
      value: String(day),
      label: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"][day - 1]!,
    })),
  ];
  const months = $derived(monthOptions(today));
  const presets = Object.keys(RANGE_LABELS) as RangePreset[];

  const everyoneChosen = $derived(others.length > 0 && others.every((p) => settings.people.includes(p.id)));
  const crossesMidnight = $derived(
    settings.windowStart !== settings.windowEnd && settings.windowEnd < settings.windowStart,
  );
  const windowLength = $derived(windowMinutes(settings.windowStart, settings.windowEnd));

  function togglePerson(id: number): void {
    settings.people = settings.people.includes(id) ? settings.people.filter((p) => p !== id) : [...settings.people, id];
  }

  function toggleWeekday(day: Weekday): void {
    settings.weekdays = settings.weekdays.includes(day)
      ? settings.weekdays.filter((d) => d !== day)
      : ALL_WEEKDAYS.filter((d) => d === day || settings.weekdays.includes(d));
  }

  function setFromMonth(month: string): void {
    settings.fromMonth = month;
    if (settings.toMonth < month) settings.toMonth = month;
  }
</script>

<form
  onsubmit={(event) => {
    event.preventDefault();
    onsearch();
  }}
>
  <Card title="Wer kommt mit?">
    <p class="note">Du bist immer dabei.</p>
    {#if others.length === 0}
      <p>Außer dir gibt es noch niemanden. Lade Freunde ein, dann kannst du mit ihnen suchen.</p>
    {:else}
      <ul class="people">
        {#each others as person (person.id)}
          <li>
            <label class="person">
              <input
                type="checkbox"
                checked={settings.people.includes(person.id)}
                disabled={searching}
                onchange={() => togglePerson(person.id)}
              />
              <span class="dot" style:background={person.seedColor ?? "var(--md-sys-color-primary)"} aria-hidden="true"></span>
              <span class="name">{person.username}</span>
            </label>
          </li>
        {/each}
      </ul>
      <div class="inline">
        <span class="note" aria-live="polite">{settings.people.length} ausgewählt</span>
        <Button
          variant="text"
          disabled={searching}
          onclick={() => (settings.people = everyoneChosen ? [] : others.map((p) => p.id))}
        >
          {everyoneChosen ? "Keine" : "Alle"}
        </Button>
      </div>
    {/if}
  </Card>

  <Card title="Was suchst du?">
    <div class="chips" role="group" aria-label="Art der Suche">
      <Chip label="Stunden" selected={settings.kind === "hours"} onclick={() => (settings.kind = "hours")} />
      <Chip label="Ganze Tage" selected={settings.kind === "days"} onclick={() => (settings.kind = "days")} />
    </div>

    {#if settings.kind === "hours"}
      <div class="group">
        <span class="label" id="weekdays-label">Wochentage</span>
        <div class="chips" role="group" aria-labelledby="weekdays-label">
          {#each ALL_WEEKDAYS as day (day)}
            <Chip label={WEEKDAY_LABELS[day]} selected={settings.weekdays.includes(day)} onclick={() => toggleWeekday(day)} />
          {/each}
        </div>
      </div>
      <div class="selects">
        <SelectField
          label="Mindestens"
          options={durations}
          bind:value={() => String(settings.durationMinutes), (v) => (settings.durationMinutes = Number(v))}
        />
        <SelectField
          label="Puffer vor und nach Terminen"
          options={buffers}
          bind:value={() => String(settings.bufferMinutes), (v) => (settings.bufferMinutes = Number(v))}
        />
      </div>
      <div class="selects">
        <SelectField label="Zeitfenster von" options={clocks} bind:value={settings.windowStart} />
        <SelectField label="bis" options={clocks} bind:value={settings.windowEnd} />
      </div>
      <p class="note">
        {#if crossesMidnight}
          Das Fenster reicht über Mitternacht und gehört zu dem Tag, an dem es beginnt.
        {:else}
          Ohne Änderung zählt die Zeit von 09:00 bis 23:00 Uhr.
        {/if}
        {#if settings.windowStart !== settings.windowEnd && settings.durationMinutes > windowLength}
          Die gewünschte Dauer ist länger als das Fenster.
        {/if}
      </p>
    {:else}
      <div class="selects">
        <SelectField
          label="Wie viele Tage?"
          options={dayCounts}
          bind:value={() => String(settings.days), (v) => (settings.days = Number(v))}
        />
        <SelectField
          label="Beginnt am"
          options={startDays}
          bind:value={() => (settings.startWeekday === null ? "" : String(settings.startWeekday)), (v) => (settings.startWeekday = v === "" ? null : (Number(v) as Weekday))}
        />
      </div>
      <p class="note">Ein Tag zählt als frei, wenn bei niemandem etwas eingetragen ist.</p>
    {/if}
  </Card>

  <Card title="Von wann bis wann?">
    <div class="chips" role="group" aria-label="Zeitraum">
      {#each presets as preset (preset)}
        <Chip label={RANGE_LABELS[preset]} selected={settings.range === preset} onclick={() => (settings.range = preset)} />
      {/each}
    </div>
    {#if settings.range === "months"}
      <div class="selects">
        <SelectField label="Von Monat" options={months} bind:value={() => settings.fromMonth, setFromMonth} />
        <SelectField
          label="Bis Monat"
          options={months.filter((m) => m.value >= settings.fromMonth)}
          bind:value={settings.toMonth}
        />
      </div>
    {/if}
  </Card>

  <Message text={problem} />
  <Button type="submit" full disabled={searching || locked}>{searching ? "Kalender werden gelesen …" : "Lücken suchen"}</Button>
</form>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .note,
  .label {
    font-size: 0.875rem;
  }

  .label {
    font-weight: 500;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .selects {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .inline {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .people {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
  }

  .person {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 48px;
    cursor: pointer;
  }

  .person input {
    flex: none;
    width: 24px;
    height: 24px;
    margin: 0;
    accent-color: var(--md-sys-color-primary);
  }

  .dot {
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: 50%;
  }

  .name {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--md-sys-color-on-surface);
  }
</style>
