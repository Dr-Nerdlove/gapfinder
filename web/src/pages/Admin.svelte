<script lang="ts">
  import type { AdminInvite, AdminUser } from "@lueckenfueller/shared";
  import * as api from "../lib/api";
  import InviteCreator from "../components/admin/InviteCreator.svelte";
  import OpenInvites from "../components/admin/OpenInvites.svelte";
  import UserList from "../components/admin/UserList.svelte";
  import Button from "../components/Button.svelte";
  import Card from "../components/Card.svelte";
  import Message from "../components/Message.svelte";
  import OfflineNotice from "../components/OfflineNotice.svelte";
  import Page from "../components/Page.svelte";
  import { errorMessage } from "../lib/messages";
  import { session, sessionState } from "../lib/session.svelte";

  const isAdmin = $derived(sessionState.user?.isAdmin === true);

  let invites = $state<AdminInvite[]>([]);
  let users = $state<AdminUser[]>([]);
  let loading = $state(true);
  let loadError = $state("");

  async function load(): Promise<void> {
    loading = true;
    loadError = "";
    const [inviteResult, userResult] = await Promise.all([
      session.run((o) => api.listInvites(o)),
      session.run((o) => api.listUsers(o)),
    ]);
    loading = false;
    if (inviteResult.ok && userResult.ok) {
      invites = inviteResult.data;
      users = userResult.data;
    } else if (!inviteResult.ok && inviteResult.kind === "error") {
      loadError = errorMessage(inviteResult);
    } else if (!userResult.ok && userResult.kind === "error") {
      loadError = errorMessage(userResult);
    }
    // Offline: the notice explains it, the lists stay empty.
  }

  $effect(() => {
    if (isAdmin) void load();
  });

  const byName = (a: AdminUser, b: AdminUser): number => a.username.localeCompare(b.username, "de");
</script>

<Page title="Verwaltung">
  {#if !isAdmin}
    <Card><p>Nur für den Admin.</p></Card>
  {:else}
    <OfflineNotice onretry={load} />
    <InviteCreator oncreated={(invite) => (invites = [invite, ...invites])} />
    {#if loadError}
      <Card>
        <Message text={loadError} />
        <div><Button variant="tonal" onclick={load}>Erneut versuchen</Button></div>
      </Card>
    {:else if loading}
      <Card><p aria-live="polite">Einen Moment …</p></Card>
    {:else}
      <OpenInvites {invites} onwithdrawn={(id) => (invites = invites.filter((i) => i.id !== id))} />
      <UserList
        {users}
        onrenamed={(user) => (users = users.map((u) => (u.id === user.id ? user : u)).sort(byName))}
        ondeleted={(id) => (users = users.filter((u) => u.id !== id))}
      />
    {/if}
  {/if}
</Page>
