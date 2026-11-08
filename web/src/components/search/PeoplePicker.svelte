<script lang="ts">
  import { GROUP_NAME_MAX_LENGTH, type Group, type Person } from "@lueckenfueller/shared";
  import * as api from "../../lib/api";
  import { errorMessage } from "../../lib/messages";
  import {
    addGroupToChoice,
    canSaveAsGroup,
    filterPeople,
    groupFullyChosen,
    groupLabel,
  } from "../../lib/people-groups";
  import { session } from "../../lib/session.svelte";
  import Button from "../Button.svelte";
  import Chip from "../Chip.svelte";
  import ConfirmDialog from "../ConfirmDialog.svelte";
  import Message from "../Message.svelte";
  import TextField from "../TextField.svelte";

  interface Props {
    /** Everyone with an account except the searcher. */
    others: Person[];
    /** The ids of the chosen people. */
    chosen: number[];
    groups: Group[];
    searching: boolean;
    locked: boolean;
    /** Called with the changed list after a group was made, changed or deleted. */
    ongroups: (groups: Group[]) => void;
  }

  let { others, chosen = $bindable(), groups, searching, locked, ongroups }: Props = $props();

  let query = $state("");
  let newName = $state("");
  let saving = $state(false);
  let problem = $state("");
  let deleting = $state<Group | null>(null);

  const visible = $derived(filterPeople(others, query));
  const allVisibleChosen = $derived(visible.length > 0 && visible.every((p) => chosen.includes(p.id)));
  const busy = $derived(searching || saving);

  function toggle(id: number): void {
    chosen = chosen.includes(id) ? chosen.filter((p) => p !== id) : [...chosen, id];
  }

  function toggleVisible(): void {
    const ids = new Set(visible.map((p) => p.id));
    chosen = allVisibleChosen ? chosen.filter((id) => !ids.has(id)) : [...new Set([...chosen, ...ids])];
  }

  async function run<T>(work: () => Promise<{ ok: true; data: T } | { ok: false; kind: string }>): Promise<T | null> {
    problem = "";
    saving = true;
    const result = await work();
    saving = false;
    if (result.ok) return result.data;
    if (result.kind === "error") problem = errorMessage(result as Parameters<typeof errorMessage>[0]);
    // Offline: the notice at the top of the page explains it.
    return null;
  }

  async function saveNew(): Promise<void> {
    const made = await run(() => session.run((o) => api.createGroup({ name: newName, members: [...chosen] }, o)));
    if (!made) return;
    newName = "";
    ongroups([...groups, made].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), "de")));
  }

  async function overwrite(group: Group): Promise<void> {
    const changed = await run(() => session.run((o) => api.updateGroup(group.id, { members: [...chosen] }, o)));
    if (changed) ongroups(groups.map((g) => (g.id === group.id ? changed : g)));
  }

  async function confirmDelete(): Promise<void> {
    const group = deleting;
    if (!group) return;
    const done = await run(() => session.run((o) => api.deleteGroup(group.id, o)));
    deleting = null;
    if (done !== null) ongroups(groups.filter((g) => g.id !== group.id));
  }
</script>

{#if others.length > 0}
  <TextField label="Person suchen" bind:value={query} autocomplete="off" />
{/if}

{#if groups.length > 0}
  <div class="group">
    <span class="label" id="groups-label">Meine Gruppen</span>
    <div class="chips" role="group" aria-labelledby="groups-label">
      {#each groups as group (group.id)}
        <Chip
          label={groupLabel(group, others)}
          selected={groupFullyChosen(chosen, group, others)}
          disabled={busy}
          onclick={() => (chosen = addGroupToChoice(chosen, group, others))}
        />
      {/each}
    </div>
    <p class="note">Ein Tipp auf eine Gruppe fügt ihre Leute zur Auswahl hinzu.</p>
  </div>
{/if}

{#if visible.length === 0}
  <p>Niemand mit diesem Namen gefunden.</p>
{:else}
  <ul class="people">
    {#each visible as person (person.id)}
      <li>
        <label class="person">
          <input type="checkbox" checked={chosen.includes(person.id)} disabled={searching} onchange={() => toggle(person.id)} />
          <span class="name">{person.username}</span>
        </label>
      </li>
    {/each}
  </ul>
{/if}
<div class="inline">
  <span class="note" aria-live="polite">{chosen.length} ausgewählt</span>
  <Button variant="outlined" disabled={searching || visible.length === 0} onclick={toggleVisible}>
    {#if query.trim() === ""}{allVisibleChosen ? "Keine" : "Alle"}{:else}{allVisibleChosen ? "Diese abwählen" : "Alle gefundenen"}{/if}
  </Button>
</div>

<details class="manage">
  <summary>Gruppen verwalten</summary>
  <div class="manage-body">
    <div class="new">
      <TextField
        label="Auswahl als neue Gruppe speichern"
        bind:value={newName}
        maxlength={GROUP_NAME_MAX_LENGTH}
        hint="z. B. Spieleabend"
        autocomplete="off"
      />
      <Button variant="tonal" disabled={busy || locked || newName.trim() === "" || !canSaveAsGroup(chosen)} onclick={saveNew}>
        Speichern
      </Button>
    </div>
    {#if !canSaveAsGroup(chosen)}
      <p class="note">Wähle zuerst oben die Leute aus, die in die Gruppe sollen.</p>
    {/if}
    {#each groups as group (group.id)}
      <div class="row">
        <span class="name">{group.name}</span>
        <Button variant="outlined" compact disabled={busy || locked || !canSaveAsGroup(chosen)} onclick={() => overwrite(group)}>
          Auswahl übernehmen
        </Button>
        <Button variant="outlined" compact disabled={busy || locked} onclick={() => (deleting = group)}>Löschen</Button>
      </div>
    {/each}
    <Message text={problem} />
  </div>
</details>

<ConfirmDialog
  open={deleting !== null}
  title="Gruppe löschen?"
  text={`Die Gruppe „${deleting?.name ?? ""}“ wird gelöscht. Die Personen bleiben unverändert.`}
  confirmLabel="Löschen"
  busy={saving}
  onconfirm={confirmDelete}
  oncancel={() => (deleting = null)}
/>

<style>
  .note,
  .label {
    font-size: 0.875rem;
  }

  .label {
    font-weight: 500;
  }

  .group,
  .manage-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .inline,
  .new,
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }

  .row .name {
    flex: 1;
  }

  summary {
    min-height: 48px;
    display: flex;
    align-items: center;
    cursor: pointer;
    font-weight: 500;
  }

  .people {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    max-height: 60vh;
    overflow-y: auto;
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

  .name {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--md-sys-color-on-surface);
  }
</style>
