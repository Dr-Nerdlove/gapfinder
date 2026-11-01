<script lang="ts">
  import type { CreatedInvite } from "@lueckenfueller/shared";
  import { INVITE_NAME_MAX_LENGTH, INVITE_VALID_DAYS, normalizeName, suggestUsername } from "@lueckenfueller/shared";
  import * as api from "../../lib/api";
  import { buildInviteLink } from "../../lib/links";
  import { errorMessage } from "../../lib/messages";
  import { session, sessionState } from "../../lib/session.svelte";
  import Button from "../Button.svelte";
  import Card from "../Card.svelte";
  import LinkBox from "../LinkBox.svelte";
  import Message from "../Message.svelte";
  import TextField from "../TextField.svelte";

  let { oncreated }: { oncreated: (invite: CreatedInvite) => void } = $props();

  let name = $state("");
  let busy = $state(false);
  let error = $state("");
  let link = $state("");
  let linkFor = $state("");

  const suggestion = $derived(suggestUsername(name));

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = "";
    const clean = normalizeName(name);
    if (clean === "") {
      error = "Bitte gib den Namen ein.";
      return;
    }
    busy = true;
    const result = await session.run((o) => api.createInvite({ name: clean }, o));
    busy = false;
    if (!result.ok) {
      error = errorMessage(result);
      return;
    }
    link = buildInviteLink(result.data.token);
    linkFor = result.data.suggestedUsername;
    name = "";
    oncreated(result.data);
  }
</script>

<Card title="Freunde einladen">
  <form onsubmit={submit}>
    <TextField
      label="Name (Vor- und Nachname)"
      name="invite-name"
      autocomplete="off"
      maxlength={INVITE_NAME_MAX_LENGTH}
      bind:value={name}
      disabled={busy || sessionState.offline}
    />
    {#if suggestion}<p class="preview">Benutzername-Vorschlag: {suggestion}</p>{/if}
    <Message text={error} />
    <div><Button type="submit" disabled={busy || sessionState.offline}>Einladungslink erstellen</Button></div>
  </form>
  {#if link}
    <LinkBox
      label="Einladungslink für {linkFor}"
      {link}
      note="Der Link gilt {INVITE_VALID_DAYS} Tage und nur einmal. Er wird nur jetzt angezeigt."
      shareText="Du bist zu Lückenfüller eingeladen:"
    />
  {/if}
</Card>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .preview {
    font-weight: 500;
  }
</style>
