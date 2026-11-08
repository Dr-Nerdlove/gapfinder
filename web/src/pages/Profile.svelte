<script lang="ts">
  import * as api from "../lib/api";
  import Button from "../components/Button.svelte";
  import CalendarFeed from "../components/CalendarFeed.svelte";
  import Card from "../components/Card.svelte";
  import Message from "../components/Message.svelte";
  import Notifications from "../components/Notifications.svelte";
  import OfflineNotice from "../components/OfflineNotice.svelte";
  import Page from "../components/Page.svelte";
  import SeedColorPicker from "../components/SeedColorPicker.svelte";
  import Switch from "../components/Switch.svelte";
  import TextField from "../components/TextField.svelte";
  import { errorMessage } from "../lib/messages";
  import { navigate } from "../lib/router";
  import { loginNotice, session, sessionState } from "../lib/session.svelte";
  import { setSystemColorsEnabled, systemColorState } from "../lib/theme-state.svelte";
  import { checkNewPassword } from "../lib/validation";

  const user = $derived(sessionState.user);
  const locked = $derived(sessionState.offline);

  let colorBusy = $state(false);
  let colorError = $state("");

  let currentPassword = $state("");
  let newPassword = $state("");
  let repeat = $state("");
  let passwordBusy = $state(false);
  let passwordError = $state("");
  let passwordDone = $state("");

  let loggingOut = $state(false);

  let deletePassword = $state("");
  let deleteBusy = $state(false);
  let deleteError = $state("");

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

  async function deleteAccount(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    deleteError = "";
    deleteBusy = true;
    const result = await session.deleteAccount(deletePassword);
    deleteBusy = false;
    if (!result.ok) {
      deleteError = errorMessage(result);
      return;
    }
    deletePassword = "";
    loginNotice.text = "Dein Konto ist gelöscht.";
    navigate("#/anmelden", { replace: true });
  }

  async function logout(): Promise<void> {
    loggingOut = true;
    await session.logout();
    loggingOut = false;
    navigate("#/", { replace: true });
  }
</script>

<Page title="Profil">
  <OfflineNotice />
  {#if user}
    <Card title="Benutzername">
      <p><strong>{user.username}</strong></p>
      <p class="note">Ändern kann ihn nur der Admin.</p>
    </Card>

    <Card title="Farbe">
      {#if systemColorState.available}
        <Switch label="Farben vom Handy übernehmen" checked={systemColorState.enabled} onchange={setSystemColorsEnabled} />
        <p class="note">In der App nutzt Lückenfüller dann die Farben deines Handys. Im Browser gilt deine Profilfarbe.</p>
        {#if systemColorState.enabled}
          <p class="note">Die Farbe unten gilt im Browser und in der App, wenn der Schalter aus ist.</p>
        {/if}
      {/if}
      <SeedColorPicker value={user.seedColor} disabled={colorBusy || locked} onpick={pickColor} />
      <Message text={colorError} />
    </Card>

    <CalendarFeed />

    <Notifications />

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

    <Card title="Konto löschen">
      {#if user.isAdmin}
        <p class="note">Als Admin kannst du dein Konto nicht in der App löschen.</p>
      {:else}
        <form onsubmit={deleteAccount}>
          <p class="note">
            Dein Konto wird mit deinen Kalender-Links, Geräten, Gruppen, Einstellungen und Stimmen gelöscht. Abstimmungen, die du erstellt hast,
            bleiben bis zu ihrem Ablauf bestehen; der Admin kann sie verwalten. Der Admin erfährt, dass du dein Konto gelöscht hast. Das lässt
            sich nicht rückgängig machen.
          </p>
          <input type="text" name="username" autocomplete="username" value={user.username} hidden readonly />
          <TextField label="Passwort zur Bestätigung" name="delete-password" type="password" autocomplete="current-password" bind:value={deletePassword} required disabled={deleteBusy || locked} />
          <Message text={deleteError} />
          <div><Button type="submit" variant="danger" disabled={deleteBusy || locked}>Konto endgültig löschen</Button></div>
        </form>
      {/if}
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
