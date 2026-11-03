<script lang="ts">
  import * as api from "../lib/api";
  import Button from "../components/Button.svelte";
  import Card from "../components/Card.svelte";
  import Message from "../components/Message.svelte";
  import OfflineNotice from "../components/OfflineNotice.svelte";
  import Page from "../components/Page.svelte";
  import TextField from "../components/TextField.svelte";
  import { ERROR_MESSAGES, errorMessage } from "../lib/messages";
  import { navigate } from "../lib/router";
  import { session, sessionState } from "../lib/session.svelte";
  import { checkNewPassword } from "../lib/validation";

  let { token }: { token: string } = $props();

  type Load = { kind: "loading" } | { kind: "invalid" } | { kind: "offline" } | { kind: "error"; text: string } | { kind: "ready" };
  let load = $state<Load>({ kind: "loading" });
  let username = $state("");
  let password = $state("");
  let repeat = $state("");
  let busy = $state(false);
  let error = $state("");

  async function loadInfo(): Promise<void> {
    load = { kind: "loading" };
    const result = await session.run((o) => api.getInvite(token, o), false);
    if (result.ok) {
      username = result.data.suggestedUsername;
      load = { kind: "ready" };
    } else if (result.kind === "offline") {
      load = { kind: "offline" };
    } else if (result.code === "invite_invalid" || result.code === "not_found") {
      load = { kind: "invalid" };
    } else {
      load = { kind: "error", text: errorMessage(result) };
    }
  }

  $effect(() => {
    token;
    void loadInfo();
  });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = "";
    const passwordProblem = checkNewPassword(password, repeat);
    if (passwordProblem) {
      error = passwordProblem;
      return;
    }
    busy = true;
    const result = await session.acceptInvite(token, username, password);
    busy = false;
    if (result.ok) navigate("#/");
    else if (result.kind === "error" && result.code === "invite_invalid") load = { kind: "invalid" };
    else error = errorMessage(result);
  }
</script>

<Page title="Willkommen bei Lückenfüller" back={false}>
  {#if load.kind === "loading"}
    <Card><p aria-live="polite">Einen Moment …</p></Card>
  {:else if load.kind === "invalid"}
    <Card title="Diese Einladung gilt nicht mehr">
      <p>{ERROR_MESSAGES.invite_invalid}</p>
      <div><Button variant="tonal" href="#/">Zur Startseite</Button></div>
    </Card>
  {:else if load.kind === "offline"}
    <OfflineNotice onretry={loadInfo} />
  {:else if load.kind === "error"}
    <Card>
      <Message text={load.text} />
      <div><Button variant="tonal" onclick={loadInfo}>Erneut versuchen</Button></div>
    </Card>
  {:else}
    <OfflineNotice />
    <Card title="Konto anlegen">
      <form onsubmit={submit}>
        <p>Dein Benutzername: <strong>{username}</strong></p>
        <p class="note">Merk ihn dir gut, du brauchst ihn zum Anmelden. Ändern kann ihn nur der Admin.</p>
        <input type="text" name="username" autocomplete="username" value={username} hidden readonly />
        <TextField label="Passwort" name="new-password" type="password" autocomplete="new-password" bind:value={password} required disabled={busy || sessionState.offline} />
        <TextField label="Passwort wiederholen" name="repeat-password" type="password" autocomplete="new-password" bind:value={repeat} required disabled={busy || sessionState.offline} />
        <Message text={error} />
        <Button type="submit" full disabled={busy || sessionState.offline}>Konto anlegen</Button>
      </form>
    </Card>
  {/if}
</Page>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .note {
    font-size: 0.875rem;
  }
</style>
