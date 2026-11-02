<script lang="ts">
  import type { PollSummary } from "@lueckenfueller/shared";
  import { untrack } from "svelte";
  import * as api from "../lib/api";
  import { errorMessage } from "../lib/messages";
  import { needsVote, summaryLine } from "../lib/poll-view";
  import { session, sessionState } from "../lib/session.svelte";
  import Button from "../components/Button.svelte";
  import Card from "../components/Card.svelte";
  import Message from "../components/Message.svelte";
  import OfflineNotice from "../components/OfflineNotice.svelte";
  import Page from "../components/Page.svelte";

  const user = $derived(sessionState.user);
  let polls = $state<PollSummary[] | null>(null);
  let loading = $state(true);
  let loadError = $state("");

  async function load(): Promise<void> {
    loading = true;
    loadError = "";
    const result = await session.run((o) => api.listPolls(o));
    loading = false;
    if (result.ok) polls = result.data.polls;
    else if (result.kind === "error") loadError = errorMessage(result);
    // Offline: the notice explains it; a list that was loaded before stays on screen.
  }

  $effect(() => {
    if (user) untrack(() => void load());
  });
</script>

<Page title="Meine Abstimmungen" subtitle="Die du angelegt hast oder bei denen du mitmachst.">
  <OfflineNotice onretry={load} />
  {#if loadError}
    <Card>
      <Message text={loadError} />
      <div><Button variant="tonal" onclick={load}>Erneut versuchen</Button></div>
    </Card>
  {:else if polls === null}
    <Card>
      {#if loading}
        <p aria-live="polite">Einen Moment …</p>
      {:else}
        <p>Die Liste kann gerade nicht geladen werden. Sobald der Server wieder wach ist, erscheint sie hier.</p>
      {/if}
    </Card>
  {:else if polls.length === 0}
    <Card title="Noch keine Abstimmung">
      <p>Suche nach Lücken und tippe auf die Zeiten, die du vorschlagen möchtest.</p>
      <div><Button href="#/suche">Lücken suchen</Button></div>
    </Card>
  {:else}
    {#each polls as poll (poll.id)}
      <a class="poll" href="#/abstimmung/{encodeURIComponent(poll.shareToken)}">
        <Card>
          <strong>{poll.title}</strong>
          <span class="line">{summaryLine(poll)}</span>
          {#if poll.creator}<span class="line">Von {poll.creator.username}</span>{/if}
          {#if needsVote(poll)}<span class="tag">Du hast noch nicht abgestimmt</span>{:else if poll.voted}<span class="tag done">Abgestimmt ✓</span>{/if}
        </Card>
      </a>
    {/each}
  {/if}
</Page>

<style>
  .poll {
    display: block;
    color: inherit;
    text-decoration: none;
  }

  strong {
    font-size: 1.125rem;
    color: var(--md-sys-color-on-surface);
  }

  .line {
    font-size: 0.9375rem;
  }

  .tag {
    align-self: flex-start;
    padding: 2px 12px;
    border-radius: 8px;
    background: var(--md-sys-color-secondary-container);
    color: var(--md-sys-color-on-secondary-container);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .tag.done {
    background: transparent;
    padding: 0;
  }
</style>
