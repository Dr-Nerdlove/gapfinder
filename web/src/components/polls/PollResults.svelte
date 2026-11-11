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
              {#if best.has(proposal.id)}<span aria-hidden="true">★ </span>{/if}{heading.top}{#if heading.bottom}<br /><small>{heading.bottom}</small>{/if}
              {#if best.has(proposal.id)}<span class="visually-hidden">{fixed ? " (festgelegter Termin)" : " (meiste Ja)"}</span>{/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each poll.votes as vote (vote.id)}
          <tr>
            <th scope="row" class="name">
              <span class="who">
                <span>{vote.name}{#if vote.personId !== null}<span class="check" title="Mit Konto abgestimmt" aria-label="mit Konto">✓</span>{/if}</span>
                {#if onremove}
                  <button type="button" class="remove" disabled={busy} aria-label={`Stimme von ${vote.name} löschen`} onclick={() => onremove(vote.id, vote.name)}>✕</button>
                {/if}
              </span>
            </th>
            {#each poll.proposals as proposal (proposal.id)}
              {@const answer = answerOf(vote, proposal.id)}
              <td>
                <span class="mark {answer ?? 'none'}">
                  <span aria-hidden="true">{answer === "yes" ? "✓" : answer === "maybe" ? "?" : ""}</span>
                  <span class="visually-hidden">{answer ? ANSWER_LABELS[answer] : "noch offen"}</span>
                </span>
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
      {#if poll.votes.length > 0}
        <tfoot>
          <tr>
            <th scope="row">Ja</th>
            {#each sums as sum (sum.proposalId)}
              <td class:best={best.has(sum.proposalId)}>
                <span aria-hidden="true">{sum.yes}</span>
                <span class="visually-hidden">{tallyText(sum)}</span>
              </td>
            {/each}
          </tr>
        </tfoot>
      {/if}
    </table>
  </div>
  <ul class="legend" aria-label="Zeichenerklärung">
    <li><span class="mark yes" aria-hidden="true">✓</span> Ja</li>
    <li><span class="mark maybe" aria-hidden="true">?</span> Vielleicht</li>
    <li><span class="mark no" aria-hidden="true"></span> Nein</li>
    <li><span class="mark none" aria-hidden="true"></span> noch offen</li>
    {#if best.size > 0}<li><span class="star" aria-hidden="true">★</span> {fixed ? "festgelegter Termin" : "meiste Ja"}</li>{/if}
  </ul>
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
    font-size: 0.875rem;
  }

  th,
  td {
    padding: 4px 2px;
    border-top: 1px solid var(--md-sys-color-outline-variant);
    text-align: center;
    vertical-align: middle;
  }

  thead th {
    border-top: 0;
    font-weight: 600;
    min-width: 3.5rem;
    vertical-align: bottom;
  }

  th[scope="row"] {
    text-align: left;
    font-weight: 600;
    min-width: 5.5rem;
    padding-right: 4px;
  }

  small {
    font-weight: 400;
  }

  /* The best (or fixed) proposal is marked with a star and bold type, not with a fill. */
  .best {
    font-weight: 700;
  }

  .who {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 2px;
  }

  /* Colour is never the only sign: ✓ and ? are visible, and every square also has its word for screen readers. */
  .mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    font-size: 0.9375rem;
    font-weight: 700;
    line-height: 1;
    vertical-align: middle;
  }

  .mark.yes {
    background: #2e9d4f;
    color: #fff;
  }

  .mark.maybe {
    background: #f2b705;
    color: #1d1b20;
  }

  .mark.no {
    background: color-mix(in srgb, var(--md-sys-color-on-surface) 15%, transparent);
  }

  .mark.none {
    border: 1.5px dashed var(--md-sys-color-outline);
  }

  .check {
    margin-left: 4px;
    color: var(--md-sys-color-primary);
  }

  .remove {
    flex: none;
    min-width: 32px;
    min-height: 32px;
    padding: 0;
    border: 0;
    border-radius: 16px;
    background: none;
    color: var(--md-sys-color-error);
    font-size: 0.875rem;
    cursor: pointer;
  }

  .remove:disabled {
    opacity: 0.4;
    cursor: default;
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
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
    font-size: 0.8125rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .legend .mark {
    width: 18px;
    height: 18px;
    border-radius: 5px;
    font-size: 0.75rem;
  }

  .star {
    color: var(--md-sys-color-on-surface);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
