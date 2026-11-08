<script lang="ts">
  import type { PollView, VoteAnswer } from "@lueckenfueller/shared";
  import { VOTE_NAME_MAX_LENGTH } from "@lueckenfueller/shared";
  import type { CalendarHint } from "../../lib/poll-calendar";
  import { ANSWER_LABELS, ANSWERS, answersOfVote, proposalLabel, type AnswerMap } from "../../lib/poll-view";
  import Button from "../Button.svelte";
  import Card from "../Card.svelte";
  import Chip from "../Chip.svelte";
  import Message from "../Message.svelte";
  import TextField from "../TextField.svelte";

  interface Props {
    poll: PollView;
    /** Logged in: the vote is the account's own and needs no name. */
    loggedIn: boolean;
    /** The id of the vote this person already has (account vote or this device's guest vote), or null. */
    voteId: number | null;
    /** The name the device used last. */
    initialName: string;
    busy: boolean;
    locked: boolean;
    problem: string;
    onsubmit: (name: string, answers: AnswerMap) => void;
    onwithdraw: () => void;
    /** What the person's own calendar says about a proposal, for the answer currently chosen in the form. */
    hintFor?: (proposalId: number, answer: VoteAnswer | undefined) => CalendarHint | null;
  }

  let { poll, loggedIn, voteId, initialName, busy, locked, problem, onsubmit, onwithdraw, hintFor }: Props = $props();

  let name = $state("");
  let answers = $state<AnswerMap>({});
  let filledFor = $state<number | null | undefined>(undefined);

  // Fill the form from the person's existing vote once (not on every refresh: that would overwrite what they type).
  $effect(() => {
    if (filledFor === voteId) return;
    filledFor = voteId;
    answers = answersOfVote(poll, voteId);
    const own = poll.votes.find((v) => v.id === voteId);
    name = own?.name ?? initialName;
  });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    onsubmit(name, $state.snapshot(answers));
  }
</script>

<Card title={voteId === null ? "Deine Stimme" : "Deine Stimme ändern"}>
  <form onsubmit={submit} class="form">
    {#if !loggedIn}
      <TextField
        label="Dein Name"
        bind:value={name}
        maxlength={VOTE_NAME_MAX_LENGTH}
        autocomplete="name"
        hint="Alle mit dem Link sehen deinen Namen. Dieses Gerät merkt sich deine Stimme, so kannst du sie später ändern."
      />
    {/if}
    {#each poll.proposals as proposal (proposal.id)}
      <fieldset>
        <legend>{proposalLabel(proposal)}</legend>
        {#if hintFor}
          {@const hint = hintFor(proposal.id, answers[proposal.id])}
          {#if hint}<p class="hint {hint.tone}">{hint.text}</p>{/if}
        {/if}
        <div class="answers">
          {#each ANSWERS as answer (answer)}
            <Chip label={ANSWER_LABELS[answer]} selected={answers[proposal.id] === answer} onclick={() => (answers[proposal.id] = answer)} />
          {/each}
        </div>
      </fieldset>
    {/each}
    <Message text={problem} />
    <div class="actions">
      <Button type="submit" disabled={busy || locked}>{voteId === null ? "Stimme abgeben" : "Stimme ändern"}</Button>
      {#if voteId !== null}
        <Button variant="outlined" disabled={busy || locked} onclick={onwithdraw}>Stimme zurückziehen</Button>
      {/if}
    </div>
  </form>
</Card>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  fieldset {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    padding: 0;
    margin-bottom: 8px;
    font-weight: 600;
    color: var(--md-sys-color-on-surface);
  }

  .hint {
    margin: 0;
    font-size: 0.875rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .hint.busy {
    color: var(--md-sys-color-on-surface);
    font-style: italic;
  }

  .hint.conflict {
    align-self: flex-start;
    padding: 4px 10px;
    border-radius: 8px;
    font-weight: 600;
    background: var(--md-sys-color-error-container);
    color: var(--md-sys-color-on-error-container);
  }

  .answers,
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
