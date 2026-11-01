<script lang="ts">
  import Button from "./Button.svelte";

  interface Props {
    label: string;
    link: string;
    note: string;
    /** Text for the share sheet of the phone. */
    shareText: string;
  }

  let { label, link, note, shareText }: Props = $props();

  const id = $props.id();
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  let feedback = $state("");
  let input = $state<HTMLInputElement>();

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      feedback = "Kopiert";
    } catch {
      input?.select();
      feedback = "Kopieren hat nicht geklappt. Bitte kopiere den Link von Hand.";
    }
  }

  async function share(): Promise<void> {
    try {
      await navigator.share({ title: "Lückenfüller", text: shareText, url: link });
    } catch {
      // The person closed the share sheet; nothing to do.
    }
  }
</script>

<div class="box">
  <label for={id}>{label}</label>
  <input {id} bind:this={input} readonly value={link} onfocus={(e) => e.currentTarget.select()} />
  <div class="actions">
    <Button variant="tonal" onclick={copy}>Kopieren</Button>
    {#if canShare}<Button variant="tonal" onclick={share}>Teilen</Button>{/if}
    <span class="feedback" aria-live="polite">{feedback}</span>
  </div>
  <p class="note">{note}</p>
</div>

<style>
  .box {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  label {
    font-size: 0.875rem;
    font-weight: 500;
  }

  input {
    min-height: 48px;
    padding: 0 16px;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: 12px;
    background: var(--md-sys-color-surface);
    color: var(--md-sys-color-on-surface);
    font: inherit;
    font-size: 0.875rem;
    width: 100%;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .feedback {
    font-weight: 500;
  }

  .note {
    font-size: 0.875rem;
  }
</style>
