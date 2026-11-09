<script lang="ts">
  import type { PollView } from "@lueckenfueller/shared";
  import { fixedIdOf, startChoice, warningLines, type CheckReview } from "../../lib/fix-date";
  import { bestProposalIds, proposalLabel, tallies, tallyText } from "../../lib/poll-view";
  import Button from "../Button.svelte";
  import Card from "../Card.svelte";
  import ConfirmDialog from "../ConfirmDialog.svelte";
  import Message from "../Message.svelte";

  interface Props {
    poll: PollView;
    busy: boolean;
    locked: boolean;
    /** The text of a failed action. */
    problem: string;
    /** Reads the calendars again for this proposal. Never rejects. */
    oncheck: (proposalId: number) => Promise<CheckReview>;
    onfix: (proposalId: number) => void;
    onunfix: () => void;
  }

  let { poll, busy, locked, problem, oncheck, onfix, onunfix }: Props = $props();

  const fixedId = $derived(fixedIdOf(poll));
  const sums = $derived(tallies(poll));
  const best = $derived(bestProposalIds(poll));
  const id = $props.id();

  // The choice starts on the fixed or the best proposal and then belongs to the person, until they pick again.
  let picked = $state<number | null>(null);
  const choice = $derived(picked ?? startChoice(poll, best));
  const chosen = $derived(poll.proposals.find((p) => p.id === choice) ?? null);

  /** "2 Ja · 1 Vielleicht · festgelegt" */
  function detail(proposalId: number, index: number): string {
    const note = proposalId === fixedId ? " · festgelegt" : best.includes(proposalId) ? " · die meisten „Ja“" : "";
    return `${tallyText(sums[index]!)}${note}`;
  }

  let dialog = $state<HTMLDialogElement>();
  let review = $state<CheckReview | "checking" | null>(null);
  let confirmingUnfix = $state(false);

  $effect(() => {
    if (!dialog) return;
    if (review !== null && !dialog.open) dialog.showModal();
    if (review === null && dialog.open) dialog.close();
  });

  async function start(): Promise<void> {
    if (!chosen) return;
    const mine = chosen.id;
    review = "checking";
    const result = await oncheck(mine);
    // Cancelled while the calendars were read, or another choice was started: drop this answer.
    if (review === "checking" && mine === choice) review = result;
  }

  function confirmFix(): void {
    if (!chosen) return;
    const mine = chosen.id;
    review = null;
    onfix(mine);
  }

  function unfix(): void {
    confirmingUnfix = false;
    onunfix();
  }
</script>

<Card title={fixedId === null ? "Termin festlegen" : "Termin ändern"} help="pollFix">
  <p class="note">
    {#if fixedId === null}
      Wähle den Termin, der gelten soll. Vorher prüft die App noch einmal die Kalender. Danach können alle nicht mehr abstimmen.
    {:else}
      Wähle einen anderen Termin, oder hebe die Festlegung auf, dann geht das Abstimmen wieder.
    {/if}
  </p>
  <fieldset>
    <legend class="visually-hidden">Termin</legend>
    {#each poll.proposals as proposal, index (proposal.id)}
      <label class="option" class:best={best.includes(proposal.id)} class:current={proposal.id === fixedId}>
        <input type="radio" name="{id}-choice" value={proposal.id} checked={proposal.id === choice} onchange={() => (picked = proposal.id)} />
        <span>
          <strong>{proposalLabel(proposal)}</strong>
          <small>{detail(proposal.id, index)}</small>
        </span>
      </label>
    {/each}
  </fieldset>
  <div class="actions">
    <Button disabled={busy || locked || chosen === null || chosen.id === fixedId} onclick={start}>
      {fixedId === null ? "Kalender prüfen und festlegen" : "Kalender prüfen und ändern"}
    </Button>
    {#if fixedId !== null}
      <Button variant="tonal" disabled={busy || locked} onclick={() => (confirmingUnfix = true)}>Festlegung aufheben</Button>
    {/if}
  </div>
  <Message text={problem} />
</Card>

<dialog bind:this={dialog} aria-labelledby="{id}-title" oncancel={() => (review = null)}>
  <h2 id="{id}-title">{chosen ? `${proposalLabel(chosen)} ${fixedId === null ? "festlegen" : "übernehmen"}?` : "Termin festlegen?"}</h2>
  {#if review === "checking"}
    <p aria-live="polite">Die Kalender werden geprüft … Das kann einen Moment dauern.</p>
    <div class="buttons"><Button variant="outlined" onclick={() => (review = null)}>Abbrechen</Button></div>
  {:else if review !== null}
    {#if review.kind === "checked" && review.clear}
      <p class="ok">Laut Kalender haben alle Zeit.</p>
    {:else if review.kind === "checked"}
      <div class="warn">
        <strong>Achtung, vielleicht passt es nicht für alle:</strong>
        <ul>
          {#each warningLines(review.check) as line (line)}<li>{line}</li>{/each}
        </ul>
      </div>
      <p>Das ist nur ein Hinweis. Du kannst den Termin trotzdem festlegen.</p>
    {:else}
      <div class="warn"><p>{review.text}</p></div>
      <p>Du kannst den Termin trotzdem festlegen.</p>
    {/if}
    <p>Danach können alle nicht mehr abstimmen.</p>
    <div class="buttons">
      <Button variant="outlined" onclick={() => (review = null)}>Abbrechen</Button>
      <Button disabled={busy || locked} onclick={confirmFix}>
        {review.kind === "checked" && review.clear ? "Festlegen" : "Trotzdem festlegen"}
      </Button>
    </div>
  {/if}
</dialog>

<ConfirmDialog
  open={confirmingUnfix}
  title="Festlegung aufheben?"
  text="Der Termin steht danach nicht mehr fest und alle können wieder abstimmen (außer die Abstimmung ist von Hand geschlossen oder die Frist ist vorbei)."
  confirmLabel="Festlegung aufheben"
  {busy}
  onconfirm={unfix}
  oncancel={() => (confirmingUnfix = false)}
/>

<style>
  .note {
    font-size: 0.875rem;
  }

  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .option {
    display: flex;
    gap: 12px;
    align-items: center;
    min-height: 56px;
    padding: 8px 16px;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: 16px;
    background: var(--md-sys-color-surface);
    color: var(--md-sys-color-on-surface);
    cursor: pointer;
  }

  .option.best,
  .option.current {
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-primary-container);
  }

  .option input {
    width: 24px;
    height: 24px;
    flex: none;
    accent-color: var(--md-sys-color-primary);
  }

  .option span {
    display: flex;
    flex-direction: column;
  }

  small {
    font-size: 0.875rem;
  }

  .actions,
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  dialog {
    width: min(28rem, calc(100vw - 32px));
    padding: 24px;
    border: 0;
    border-radius: var(--radius-card);
    background: var(--md-sys-color-surface-container-high, var(--md-sys-color-surface));
    color: var(--md-sys-color-on-surface);
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 0.5);
  }

  dialog h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 8px;
  }

  dialog p,
  .warn {
    margin-bottom: 8px;
  }

  .warn {
    padding: 12px 16px;
    border-radius: 16px;
    background: var(--md-sys-color-error-container);
    color: var(--md-sys-color-on-error-container);
  }

  .warn ul {
    margin: 4px 0 0;
    padding-left: 20px;
  }

  .ok {
    padding: 12px 16px;
    border-radius: 16px;
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-primary-container);
    font-weight: 600;
  }

  .buttons {
    justify-content: flex-end;
    margin-top: 16px;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
