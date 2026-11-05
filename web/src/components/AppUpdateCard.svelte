<script lang="ts">
  import { onMount } from "svelte";
  import { MANUAL_TEXT, RELEASE_PAGE_URL, UPDATE_TITLE, availableText, installNote, type InstallAnswer } from "../lib/app-update";
  import { appUpdateState, ensureAppUpdate } from "../lib/app-update-state.svelte";
  import { Lueckenfueller } from "../lib/native";
  import Button from "./Button.svelte";
  import Card from "./Card.svelte";

  let busy = $state(false);
  let note = $state("");

  onMount(() => {
    void ensureAppUpdate();
  });

  const view = $derived(appUpdateState.view);

  async function update(): Promise<void> {
    busy = true;
    note = "";
    let answer: InstallAnswer = null;
    try {
      answer = await Lueckenfueller.installAppUpdate();
    } catch {
      answer = null;
    }
    note = installNote(answer);
    busy = false;
  }

  function openReleasePage(): void {
    void Lueckenfueller.openExternal({ url: RELEASE_PAGE_URL }).catch(() => undefined);
  }
</script>

{#if view?.kind === "available"}
  <Card title={UPDATE_TITLE} tone="notice">
    <p>{availableText(view.version)}</p>
    {#if note}<p role="status">{note}</p>{/if}
    <div class="actions"><Button disabled={busy} onclick={update}>{busy ? "Wird geladen …" : "Aktualisieren"}</Button></div>
  </Card>
{:else if view?.kind === "manual"}
  <Card title={UPDATE_TITLE} tone="notice">
    <p>{MANUAL_TEXT}</p>
    <div class="actions"><Button onclick={openReleasePage}>Zur Release-Seite</Button></div>
  </Card>
{/if}

<style>
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
