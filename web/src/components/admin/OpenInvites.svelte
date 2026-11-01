<script lang="ts">
  import type { AdminInvite } from "@lueckenfueller/shared";
  import * as api from "../../lib/api";
  import { formatDate } from "../../lib/format";
  import { errorMessage } from "../../lib/messages";
  import { session, sessionState } from "../../lib/session.svelte";
  import Button from "../Button.svelte";
  import Card from "../Card.svelte";
  import Message from "../Message.svelte";

  let { invites, onwithdrawn }: { invites: AdminInvite[]; onwithdrawn: (id: number) => void } = $props();

  let busyId = $state<number | null>(null);
  let error = $state("");

  async function withdraw(invite: AdminInvite): Promise<void> {
    error = "";
    busyId = invite.id;
    const result = await session.run((o) => api.deleteInvite(invite.id, o));
    busyId = null;
    // A missing invite is already gone: same result as withdrawing it.
    if (result.ok || (result.kind === "error" && result.code === "not_found")) onwithdrawn(invite.id);
    else error = errorMessage(result);
  }
</script>

<Card title="Offene Einladungen">
  {#if invites.length === 0}
    <p>Keine offenen Einladungen.</p>
  {:else}
    <ul>
      {#each invites as invite (invite.id)}
        <li>
          <div class="text">
            <strong>{invite.suggestedUsername}</strong>
            <span>gültig bis {formatDate(invite.expiresAt)}</span>
          </div>
          <Button variant="text" disabled={busyId !== null || sessionState.offline} onclick={() => withdraw(invite)}>
            Zurückziehen
          </Button>
        </li>
      {/each}
    </ul>
  {/if}
  <Message text={error} />
</Card>

<style>
  ul {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .text {
    display: flex;
    flex-direction: column;
  }

  span {
    font-size: 0.875rem;
  }
</style>
