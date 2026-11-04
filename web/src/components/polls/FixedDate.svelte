<script lang="ts">
  import type { PollView, Proposal } from "@lueckenfueller/shared";
  import * as api from "../../lib/api";
  import { eventOf, googleCalendarUrl, outlookCalendarUrl } from "../../lib/fix-date";
  import { errorMessage } from "../../lib/messages";
  import { Lueckenfueller, isAndroidApp } from "../../lib/native";
  import { deliverIcs } from "../../lib/native-actions";
  import { proposalLabel } from "../../lib/poll-view";
  import Button from "../Button.svelte";
  import Message from "../Message.svelte";

  interface Props {
    poll: PollView;
    proposal: Proposal;
    /** The server is not reachable: the download needs it, the two links do not. */
    locked: boolean;
  }

  let { poll, proposal, locked }: Props = $props();

  const event = $derived(eventOf(poll, proposal));
  let downloading = $state(false);
  let problem = $state("");

  function downloadInBrowser(text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: "text/calendar" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "termin.ics";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /** Fetches the file in the app (so a sleeping server shows a message) and hands it to the browser (or, in the Android app, to the calendar). */
  async function download(): Promise<void> {
    downloading = true;
    problem = "";
    const result = await api.getEventIcs(poll.shareToken);
    downloading = false;
    if (!result.ok) {
      problem = errorMessage(result);
      return;
    }
    try {
      await deliverIcs({ isApp: isAndroidApp(), app: Lueckenfueller, download: downloadInBrowser }, result.data);
    } catch {
      problem = "Die Datei konnte nicht geöffnet werden. Versuche es noch einmal.";
    }
  }
</script>

<section class="fixed" aria-labelledby="fixed-title">
  <span class="tag">Termin steht ✓</span>
  <h2 id="fixed-title">{proposalLabel(proposal)}</h2>
  {#if poll.note}<p class="note">{poll.note}</p>{/if}
  <p class="info">Abstimmen geht nicht mehr.</p>
  <div class="actions">
    <Button full disabled={downloading || locked} onclick={download}>.ics herunterladen</Button>
    <Button full external href={googleCalendarUrl(event)}>In Google Kalender eintragen</Button>
    <Button full external href={outlookCalendarUrl(event)}>In Outlook eintragen</Button>
  </div>
  <Message text={problem} />
</section>

<style>
  .fixed {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 20px 24px;
    border: 2px solid var(--md-sys-color-primary);
    border-radius: var(--radius-card);
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-primary-container);
  }

  h2 {
    font-size: 1.5rem;
    line-height: 1.3;
    font-weight: 700;
  }

  .tag {
    align-self: flex-start;
    padding: 2px 12px;
    border-radius: 8px;
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .note {
    white-space: pre-wrap;
  }

  .info {
    font-size: 0.875rem;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
