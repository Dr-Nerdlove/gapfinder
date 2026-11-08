<script lang="ts">
  import type { CreatedInvite } from "@lueckenfueller/shared";
  import { INVITE_VALID_DAYS, normalizeName, USERNAME_MAX_LENGTH } from "@lueckenfueller/shared";
  import * as api from "../../lib/api";
  import { inviteMessage } from "../../lib/invite-text";
  import { buildInviteLink } from "../../lib/links";
  import { errorMessage } from "../../lib/messages";
  import { checkUsername } from "../../lib/validation";
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

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = "";
    const clean = normalizeName(name);
    const problem = checkUsername(clean);
    if (problem) {
      error = problem;
      return;
    }
    busy = true;
    const result = await session.run((o) => api.createInvite(api.inviteRequest(clean), o));
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
      label="Benutzername"
      name="invite-name"
      autocomplete="off"
      hint="Genau so, wie er in der App erscheinen und zum Anmelden genutzt werden soll, z. B. „Samuel Kr.“"
      maxlength={USERNAME_MAX_LENGTH}
      bind:value={name}
      disabled={busy || sessionState.offline}
    />
    <Message text={error} />
    <div><Button type="submit" disabled={busy || sessionState.offline}>Einladungslink erstellen</Button></div>
  </form>
  {#if link}
    <LinkBox
      label="Einladungslink für {linkFor}"
      {link}
      note="Der Link gilt {INVITE_VALID_DAYS} Tage und nur einmal. Er wird nur jetzt angezeigt."
      shareText="Du bist zu Lückenfüller eingeladen:"
      message={inviteMessage(link, INVITE_VALID_DAYS)}
    />
  {/if}
</Card>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
</style>
