<script lang="ts">
  import type { PollView } from "@lueckenfueller/shared";
  import {
    ANSWER_LABELS,
    answerOf,
    highlightedProposalIds,
    notVotedYet,
    proposalHeading,
    tallies,
    tallyText,
  } from "../../lib/poll-view";
  import Card from "../Card.svelte";

  interface Props {
    poll: PollView;
    /** Creator and admin can remove single votes. */
    onremove?: ((voteId: number, name: string) => void) | undefined;
    busy?: boolean;
  }

  let { poll, onremove, busy = false }: Props = $props();

  const sums = $derived(tallies(poll));
  const best = $derived(new Set(highlightedProposalIds(poll)));
  const fixed = $derived(poll.fixedProposalId != null);
  const missing = $derived(notVotedYet(poll));
</script>

<Card title="Stand der Abstimmung" help="pollAnswers">
  {#if poll.votes.length === 0}
    <p>Noch niemand hat abgestimmt.</p>
  {/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="scroll" tabindex="0" role="region" aria-label="Tabelle der Stimmen">
    <table>
      <thead>
        <tr>
          <th scope="col"><span class="visually-hidden">Name</span></th>
          {#each poll.proposals as proposal (proposal.id)}
            {@const heading = proposalHeading(proposal)}
            <th scope="col" class:best={best.has(proposal.id)}>
              {heading.top}{#if heading.bottom}<br /><small>{heading.bottom}</small>{/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each poll.votes as vote (vote.id)}
          <tr>
            <th scope="row" class="name">
              {vote.name}{#if vote.personId !== null}<span class="check" title="Mit Konto abgestimmt" aria-label="mit Konto">✓</span>{/if}
              {#if onremove}
                <button type="button" class="remove" disabled={busy} onclick={() => onremove(vote.id, vote.name)}>Stimme löschen</button>
              {/if}
            </th>
            {#each poll.proposals as proposal (proposal.id)}
              {@const answer = answerOf(vote, proposal.id)}
              <td class={answer ?? "none"}>{answer ? ANSWER_LABELS[answer] : "–"}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
      {#if poll.votes.length > 0}
        <tfoot>
          <tr>
            <th scope="row">Summe</th>
            {#each sums as sum (sum.proposalId)}
              <td class:best={best.has(sum.proposalId)}>{tallyText(sum)}</td>
            {/each}
          </tr>
        </tfoot>
      {/if}
    </table>
  </div>
  {#if best.size > 0}
    <p class="legend"><span class="best-mark">Hervorgehoben</span> ist {fixed ? "der festgelegte Termin" : "der Termin mit den meisten „Ja“"}.</p>
  {/if}
</Card>

{#if missing.length > 0}
  <Card title="Noch nicht abgestimmt">
    <ul class="people">
      {#each missing as person (person.id)}<li>{person.username}</li>{/each}
    </ul>
  </Card>
{/if}

<style>
  .scroll {
    overflow-x: auto;
  }

  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.9375rem;
  }

  th,
  td {
    padding: 8px 6px;
    border-top: 1px solid var(--md-sys-color-outline-variant);
    text-align: center;
    vertical-align: top;
  }

  thead th {
    border-top: 0;
    font-weight: 600;
    min-width: 6rem;
  }

  th[scope="row"] {
    text-align: left;
    font-weight: 600;
    min-width: 7rem;
  }

  small {
    font-weight: 400;
  }

  .best {
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-primary-container);
    font-weight: 700;
  }

  .best-mark {
    padding: 2px 8px;
    border-radius: 8px;
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-primary-container);
  }

  /* Colour is never the only sign: every cell also says Ja, Vielleicht or Nein. */
  .yes {
    color: var(--md-sys-color-primary);
    font-weight: 700;
  }

  .maybe {
    font-weight: 600;
  }

  .no {
    color: var(--md-sys-color-error);
    font-weight: 600;
  }

  .none {
    opacity: 0.5;
  }

  .check {
    margin-left: 4px;
    color: var(--md-sys-color-primary);
  }

  .remove {
    display: block;
    min-height: 32px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--md-sys-color-error);
    font-size: 0.8125rem;
    font-weight: 500;
    text-decoration: underline;
    cursor: pointer;
  }

  .people {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .people li {
    padding: 4px 12px;
    border-radius: 8px;
    background: var(--md-sys-color-secondary-container);
    color: var(--md-sys-color-on-secondary-container);
  }

  .legend {
    font-size: 0.875rem;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
