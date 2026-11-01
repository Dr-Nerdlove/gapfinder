<script lang="ts">
  import { normalizeName } from "@lueckenfueller/shared";
  import * as api from "../lib/api";
  import Button from "../components/Button.svelte";
  import Card from "../components/Card.svelte";
  import Message from "../components/Message.svelte";
  import OfflineNotice from "../components/OfflineNotice.svelte";
  import Page from "../components/Page.svelte";
  import SeedColorPicker from "../components/SeedColorPicker.svelte";
  import TextField from "../components/TextField.svelte";
  import { errorMessage } from "../lib/messages";
  import { navigate } from "../lib/router";
  import { session, sessionState } from "../lib/session.svelte";
  import { checkNewPassword, checkUsername } from "../lib/validation";

  const user = $derived(sessionState.user);
  const locked = $derived(sessionState.offline);

  let username = $state(sessionState.user?.username ?? "");
  let nameBusy = $state(false);
  let nameError = $state("");
  let nameDone = $state("");

  let colorBusy = $state(false);
  let colorError = $state("");

  let currentPassword = $state("");
  let newPassword = $state("");
  let repeat = $state("");
  let passwordBusy = $state(false);
  let passwordError = $state("");
  let passwordDone = $state("");

  let loggingOut = $state(false);

  async function saveName(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    nameError = "";
    nameDone = "";
    const problem = checkUsername(username);
    if (problem) {
      nameError = problem;
      return;
    }
    nameBusy = true;
    const result = await session.updateMe({ username: normalizeName(username) });
    nameBusy = false;
    if (result.ok) {
      username = result.data.username;
      nameDone = "Gespeichert.";
    } else {
      nameError = errorMessage(result);
    }
  }

  async function pickColor(seed: string | null): Promise<void> {
    colorError = "";
    colorBusy = true;
    const result = await session.updateMe({ seedColor: seed });
    colorBusy = false;
    if (!result.ok) colorError = errorMessage(result);
  }

  async function savePassword(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    passwordError = "";
    passwordDone = "";
    const problem = checkNewPassword(newPassword, repeat);
    if (problem) {
      passwordError = problem;
      return;
    }
    passwordBusy = true;
    const result = await session.run((o) => api.changePassword({ currentPassword, newPassword }, o));
    passwordBusy = false;
    if (result.ok) {
      currentPassword = newPassword = repeat = "";
      passwordDone = "Dein Passwort ist geändert. Auf anderen Geräten wirst du abgemeldet.";
    } else {
      passwordError = errorMessage(result);
    }
  }

  async function logout(): Promise<void> {
    loggingOut = true;
    await session.logout();
    loggingOut = false;
    navigate("#/");
  }
</script>

<Page title="Profil">
  <OfflineNotice />
  {#if user}
    <Card title="Benutzername">
      <form onsubmit={saveName}>
        <TextField
          label="Benutzername"
          name="username"
          autocomplete="username"
          hint="So sehen dich deine Freunde."
          error={nameError}
          bind:value={username}
          required
          disabled={nameBusy || locked}
        />
        <Message kind="success" text={nameDone} />
        <div><Button type="submit" disabled={nameBusy || locked}>Speichern</Button></div>
      </form>
    </Card>

    <Card title="Farbe">
      <SeedColorPicker value={user.seedColor} disabled={colorBusy || locked} onpick={pickColor} />
      <Message text={colorError} />
    </Card>

    <Card title="Passwort ändern">
      <form onsubmit={savePassword}>
        <input type="text" name="username" autocomplete="username" value={user.username} hidden readonly />
        <TextField label="Aktuelles Passwort" name="current-password" type="password" autocomplete="current-password" bind:value={currentPassword} required disabled={passwordBusy || locked} />
        <TextField label="Neues Passwort" name="new-password" type="password" autocomplete="new-password" bind:value={newPassword} required disabled={passwordBusy || locked} />
        <TextField label="Neues Passwort wiederholen" name="repeat-password" type="password" autocomplete="new-password" bind:value={repeat} required disabled={passwordBusy || locked} />
        <p class="note">Auf allen anderen Geräten wirst du danach abgemeldet.</p>
        <Message text={passwordError} />
        <Message kind="success" text={passwordDone} />
        <div><Button type="submit" disabled={passwordBusy || locked}>Passwort ändern</Button></div>
      </form>
    </Card>

    <div>
      <Button variant="tonal" disabled={loggingOut} onclick={logout}>Abmelden</Button>
    </div>
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
