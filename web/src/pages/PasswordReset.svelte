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

  type Load = { kind: "loading" } | { kind: "invalid" } | { kind: "offline" } | { kind: "error"; text: string } | { kind: "ready"; username: string };
  let load = $state<Load>({ kind: "loading" });
  let password = $state("");
  let repeat = $state("");
  let busy = $state(false);
  let error = $state("");

  async function loadInfo(): Promise<void> {
    load = { kind: "loading" };
    const result = await session.run((o) => api.getPasswordReset(token, o), false);
    if (result.ok) {
      load = { kind: "ready", username: result.data.username };
    } else if (result.kind === "offline") {
      load = { kind: "offline" };
    } else if (result.code === "reset_invalid" || result.code === "not_found") {
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
    const problem = checkNewPassword(password, repeat);
    if (problem) {
      error = problem;
      return;
    }
    busy = true;
    const result = await session.completePasswordReset(token, password);
    busy = false;
    if (result.ok) navigate("#/");
    else if (result.kind === "error" && result.code === "reset_invalid") load = { kind: "invalid" };
    else error = errorMessage(result);
  }
</script>

<Page title="Passwort zurücksetzen" back={false}>
  {#if load.kind === "loading"}
    <Card><p aria-live="polite">Einen Moment …</p></Card>
  {:else if load.kind === "invalid"}
    <Card title="Dieser Link gilt nicht mehr">
      <p>{ERROR_MESSAGES.reset_invalid}</p>
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
    <Card title="Neues Passwort für {load.username}">
      <form onsubmit={submit}>
        <!-- The username is in the form (hidden from view) so password managers file the new password under it. -->
        <input type="text" name="username" autocomplete="username" value={load.username} hidden readonly />
        <TextField label="Neues Passwort" name="new-password" type="password" autocomplete="new-password" bind:value={password} required disabled={busy || sessionState.offline} />
        <TextField label="Passwort wiederholen" name="repeat-password" type="password" autocomplete="new-password" bind:value={repeat} required disabled={busy || sessionState.offline} />
        <Message text={error} />
        <Button type="submit" full disabled={busy || sessionState.offline}>Passwort speichern</Button>
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
</style>
