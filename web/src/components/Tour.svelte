<script lang="ts">
  import { tick } from "svelte";
  import { navigate } from "../lib/router";
  import Button from "./Button.svelte";

  interface Props {
    open: boolean;
    /** Null while unknown. */
    hasCalendar: boolean | null;
    onclose: () => void;
  }

  let { open, hasCalendar, onclose }: Props = $props();

  const STEP_COUNT = 6;

  let dialog = $state<HTMLDialogElement>();
  let heading = $state<HTMLHeadingElement>();
  let step = $state(1);
  const id = $props.id();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      step = 1;
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  });

  async function go(next: number): Promise<void> {
    step = next;
    await tick();
    heading?.focus();
  }

  function addCalendar(): void {
    navigate("#/kalender");
    onclose();
  }
</script>

<dialog bind:this={dialog} aria-labelledby="{id}-title" oncancel={(event) => { event.preventDefault(); onclose(); }}>
  <div class="progress">
    <span>Schritt {step} von {STEP_COUNT}</span>
    <span class="dots" aria-hidden="true">
      {#each Array.from({ length: STEP_COUNT }, (_, i) => i + 1) as n (n)}
        <span class="dot" class:current={n === step}></span>
      {/each}
    </span>
  </div>

  {#if step === 1}
    <h2 id="{id}-title" tabindex="-1" bind:this={heading}>Willkommen bei Lückenfüller</h2>
    <p>
      Lückenfüller findet Zeiten, in denen du und deine Freunde gleichzeitig frei habt. Schluss mit dem ewigen „Wann hast du Zeit?“ im
      Gruppenchat.
    </p>
    <p>In einer Minute zeigen wir dir, wie es geht.</p>
  {:else if step === 2}
    <h2 id="{id}-title" tabindex="-1" bind:this={heading}>Kalender verknüpfen</h2>
    <p>
      Du verbindest einmal deinen Kalender, zum Beispiel von Google, Apple oder Outlook. Dafür kopierst du einen Link aus deinem Kalender und
      fügst ihn in Lückenfüller ein.
    </p>
    <p>Danach weiß die App von selbst, wann du schon etwas vorhast. Eine Schritt-für-Schritt-Anleitung findest du auf der Seite „Kalender“.</p>
  {:else if step === 3}
    <h2 id="{id}-title" tabindex="-1" bind:this={heading}>Deine Termine bleiben privat</h2>
    <p>
      Deine Freunde sehen nie, was du vorhast, nur ob du zu einer Zeit frei oder belegt bist. Auch der Admin sieht in der App keine Termine.
    </p>
    <p>Die Titel deiner Termine siehst nur du selbst, in deiner eigenen Vorschau.</p>
    <p><a href="#/privatsphaere" onclick={onclose}>Was mit deinem Kalender passiert</a></p>
  {:else if step === 4}
    <h2 id="{id}-title" tabindex="-1" bind:this={heading}>Lücken suchen</h2>
    <p>
      Unter „Lücken suchen“ wählst du, wer dabei sein soll und in welchem Zeitraum. „Stunden“ passt für ein Treffen am Abend, „Ganze Tage“ für
      einen Ausflug oder Urlaub.
    </p>
    <p>Die App zeigt dir, wann alle frei sind, und auch Zeiten, in denen fast alle können.</p>
  {:else if step === 5}
    <h2 id="{id}-title" tabindex="-1" bind:this={heading}>Abstimmen lassen</h2>
    <p>Tippe die Zeiten an, die dir gefallen, und mach daraus mit „Abstimmung anlegen“ eine Abstimmung.</p>
    <p>Den Link schickst du an alle, zum Beispiel per WhatsApp. Abstimmen geht auch ohne Konto.</p>
  {:else}
    <h2 id="{id}-title" tabindex="-1" bind:this={heading}>Termin festlegen</h2>
    <p>Steht fest, wann es am besten passt, legst du den Termin fest. Alle können ihn dann mit einem Tipp in ihren Kalender eintragen.</p>
    <p>Gut zu wissen: Nachts von 1 bis 7 Uhr schläft der Server. Dann kannst du die App nur eingeschränkt nutzen.</p>
    <p class="note">Diese Einführung findest du jederzeit wieder auf der Startseite unter „Einführung“.</p>
  {/if}

  <div class="actions">
    {#if step > 1}<Button variant="text" onclick={() => go(step - 1)}>Zurück</Button>{/if}
    {#if step < STEP_COUNT}
      <Button variant="text" onclick={onclose}>Überspringen</Button>
      <Button onclick={() => go(step + 1)}>Weiter</Button>
    {:else if hasCalendar === false}
      <Button variant="text" onclick={onclose}>Später</Button>
      <Button onclick={addCalendar}>Kalender verknüpfen</Button>
    {:else}
      <Button onclick={onclose}>Los geht’s</Button>
    {/if}
  </div>
</dialog>

<style>
  dialog {
    width: min(32rem, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    overflow-y: auto;
    padding: 24px;
    border: 0;
    border-radius: var(--radius-card);
    background: var(--md-sys-color-surface-container-high, var(--md-sys-color-surface));
    color: var(--md-sys-color-on-surface);
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 0.5);
  }

  dialog[open] {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .progress {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 0.875rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .dots {
    display: flex;
    gap: 6px;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--md-sys-color-outline-variant);
  }

  .dot.current {
    background: var(--md-sys-color-primary);
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    outline: none;
  }

  a {
    color: var(--md-sys-color-primary);
    font-weight: 500;
  }

  .note {
    font-size: 0.875rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }
</style>
