<script lang="ts">
  import type { AdminUser } from "@lueckenfueller/shared";
  import { normalizeName, RESET_VALID_HOURS } from "@lueckenfueller/shared";
  import * as api from "../../lib/api";
  import { calendarProblemsText } from "../../lib/calendars";
  import { buildPasswordResetLink } from "../../lib/links";
  import { errorMessage } from "../../lib/messages";
  import { session, sessionState } from "../../lib/session.svelte";
  import { checkUsername } from "../../lib/validation";
  import Button from "../Button.svelte";
  import Card from "../Card.svelte";
  import ConfirmDialog from "../ConfirmDialog.svelte";
  import LinkBox from "../LinkBox.svelte";
  import Message from "../Message.svelte";
  import TextField from "../TextField.svelte";

  let {
    users,
    onrenamed,
    ondeleted,
  }: { users: AdminUser[]; onrenamed: (user: AdminUser) => void; ondeleted: (id: number) => void } = $props();

  let busy = $state(false);
  let renamingId = $state<number | null>(null);
  let renameValue = $state("");
  let renameError = $state("");
  let resetLinks = $state<Record<number, string>>({});
  let rowError = $state<{ id: number; text: string } | null>(null);
  let deleting = $state<AdminUser | null>(null);

  const disabled = $derived(busy || sessionState.offline);

  function startRename(user: AdminUser): void {
    renamingId = user.id;
    renameValue = user.username;
    renameError = "";
  }

  async function saveRename(event: SubmitEvent, user: AdminUser): Promise<void> {
    event.preventDefault();
    renameError = checkUsername(renameValue) ?? "";
    if (renameError) return;
    busy = true;
    const result = await session.run((o) => api.renameUser(user.id, { username: normalizeName(renameValue) }, o));
    busy = false;
    if (result.ok) {
      renamingId = null;
      onrenamed(result.data);
    } else {
      renameError = errorMessage(result);
    }
  }

  async function createReset(user: AdminUser): Promise<void> {
    rowError = null;
    busy = true;
    const result = await session.run((o) => api.createPasswordReset(user.id, o));
    busy = false;
    if (result.ok) resetLinks[user.id] = buildPasswordResetLink(result.data.token);
    else rowError = { id: user.id, text: errorMessage(result) };
  }

  async function confirmDelete(): Promise<void> {
    const user = deleting;
    if (!user) return;
    rowError = null;
    busy = true;
    const result = await session.run((o) => api.deleteUser(user.id, o));
    busy = false;
    deleting = null;
    if (result.ok || (result.kind === "error" && result.code === "not_found")) ondeleted(user.id);
    else rowError = { id: user.id, text: errorMessage(result) };
  }
</script>

<Card title="Konten">
  <ul>
    {#each users as user (user.id)}
      <li>
        <div class="head">
          <strong>{user.username}</strong>
          {#if user.isAdmin}<span class="badge">Admin</span>{/if}
          {#if calendarProblemsText(user.calendarProblems)}
            <span class="badge problem">{calendarProblemsText(user.calendarProblems)}</span>
          {/if}
        </div>
        {#if renamingId === user.id}
          <form onsubmit={(e) => saveRename(e, user)}>
            <TextField label="Neuer Benutzername" autocomplete="off" error={renameError} bind:value={renameValue} {disabled} />
            <div class="actions">
              <Button type="submit" {disabled}>Speichern</Button>
              <Button variant="text" {disabled} onclick={() => (renamingId = null)}>Abbrechen</Button>
            </div>
          </form>
        {:else}
          <div class="actions">
            <Button variant="text" {disabled} onclick={() => startRename(user)}>Umbenennen</Button>
            <Button variant="text" {disabled} onclick={() => createReset(user)}>Passwort-Link</Button>
            {#if user.id !== sessionState.user?.id}
              <Button variant="text" {disabled} onclick={() => (deleting = user)}>Löschen</Button>
            {/if}
          </div>
        {/if}
        {#if resetLinks[user.id]}
          <LinkBox
            label="Link zum Zurücksetzen für {user.username}"
            link={resetLinks[user.id]!}
            note="Der Link gilt {RESET_VALID_HOURS} Stunden und nur einmal. Er wird nur jetzt angezeigt."
            shareText="Hier kannst du ein neues Passwort für Lückenfüller wählen:"
          />
        {/if}
        {#if rowError?.id === user.id}<Message text={rowError.text} />{/if}
      </li>
    {/each}
  </ul>
</Card>

<ConfirmDialog
  open={deleting !== null}
  title="{deleting?.username ?? ''} löschen?"
  text="Das Konto von {deleting?.username ?? ''} wird dauerhaft gelöscht. Das lässt sich nicht rückgängig machen."
  confirmLabel="Löschen"
  {busy}
  onconfirm={confirmDelete}
  oncancel={() => (deleting = null)}
/>

<style>
  ul {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .badge {
    padding: 2px 10px;
    border-radius: 8px;
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-primary-container);
    font-size: 0.875rem;
    font-weight: 500;
  }

  .badge.problem {
    background: var(--md-sys-color-error-container);
    color: var(--md-sys-color-on-error-container);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
</style>
