<script lang="ts">
  import Button from "../components/Button.svelte";
  import Card from "../components/Card.svelte";
  import Message from "../components/Message.svelte";
  import OfflineNotice from "../components/OfflineNotice.svelte";
  import Page from "../components/Page.svelte";
  import TextField from "../components/TextField.svelte";
  import { errorMessage } from "../lib/messages";
  import { session, sessionState } from "../lib/session.svelte";

  let username = $state("");
  let password = $state("");
  let busy = $state(false);
  let error = $state("");

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = "";
    busy = true;
    const result = await session.login(username, password);
    busy = false;
    if (!result.ok) error = errorMessage(result);
    // On success the app notices the new user and leaves this page.
  }
</script>

<Page title="Anmelden">
  <OfflineNotice />
  <Card>
    <form onsubmit={submit}>
      <TextField label="Benutzername" name="username" autocomplete="username" bind:value={username} required disabled={busy || sessionState.offline} />
      <TextField label="Passwort" name="password" type="password" autocomplete="current-password" bind:value={password} required disabled={busy || sessionState.offline} />
      <Message text={error} />
      <Button type="submit" full disabled={busy || sessionState.offline}>Anmelden</Button>
    </form>
    <p class="hint">Passwort vergessen? Bitte den Admin um einen Link zum Zurücksetzen.</p>
  </Card>
</Page>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .hint {
    font-size: 0.875rem;
  }
</style>
