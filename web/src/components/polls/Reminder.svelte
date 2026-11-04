<script lang="ts">
  import type { PollView } from "@lueckenfueller/shared";
  import * as api from "../../lib/api";
  import { errorMessage } from "../../lib/messages";
  import { reminderResultText, reminderState } from "../../lib/reminder";
  import { session, sessionState } from "../../lib/session.svelte";
  import Button from "../Button.svelte";
  import Card from "../Card.svelte";
  import Message from "../Message.svelte";

  interface Props {
    poll: PollView;
    /** The time the page last heard from the server; the state is recomputed whenever the poll is refreshed. */
    now: Date;
    locked: boolean;
    /** Reads the poll again (so the time of the last reminder is up to date). */
    onsent: () => void;
  }

  let { poll, now, locked, onsent }: Props = $props();

  const info = $derived(reminderState(poll, sessionState.user?.id ?? null, now));
  let busy = $state(false);
  let problem = $state("");
  let done = $state("");

  async function send(): Promise<void> {
    if (busy) return;
    busy = true;
    problem = done = "";
    const result = await session.run((o) => api.sendReminder(poll.id, o));
    busy = false;
    if (result.ok) {
      done = reminderResultText(result.data);
    } else {
      problem = errorMessage(result);
    }
    // After a send, and after "too soon" or "already fixed" (the page was out of date), look at the poll again.
    if (result.ok || (result.kind === "error" && (result.code === "reminder_too_soon" || result.code === "poll_fixed"))) onsent();
  }
</script>

{#if info.show}
  <Card title="Erinnerung">
    <p class="note">Erinnert alle, die noch nicht abgestimmt haben. Geht einmal am Tag.</p>
    <div><Button disabled={!info.canSend || busy || locked} onclick={send}>Erinnerung senden</Button></div>
    {#if info.sentText}<p class="note">{info.sentText}</p>{/if}
    {#if info.nextText}<p class="note">{info.nextText}</p>{/if}
    <Message kind="success" text={done} />
    <Message text={problem} />
  </Card>
{/if}

<style>
  .note {
    font-size: 0.875rem;
  }
</style>
