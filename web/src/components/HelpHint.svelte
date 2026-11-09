<script lang="ts">
  import { HELP_TEXTS, helpSegments, type HelpTopic } from "../lib/help-texts";
  import Button from "./Button.svelte";

  interface Props {
    topic: HelpTopic;
  }

  let { topic }: Props = $props();
  const text = $derived(HELP_TEXTS[topic]);
  let dialog = $state<HTMLDialogElement>();
  const id = $props.id();

  function show() {
    if (dialog && !dialog.open) dialog.showModal();
  }

  function close() {
    if (dialog?.open) dialog.close();
  }
</script>

<button type="button" class="help" aria-label="Hilfe: {text.title}" aria-haspopup="dialog" onclick={show}>
  <span class="icon" aria-hidden="true">?</span>
</button>

<dialog bind:this={dialog} aria-labelledby="{id}-title">
  <h2 id="{id}-title">{text.title}</h2>
  {#each text.paragraphs as paragraph (paragraph)}
    <p>{#each helpSegments(paragraph) as segment, i (i)}{#if segment.strong}<strong>{segment.text}</strong>{:else}{segment.text}{/if}{/each}</p>
  {/each}
  <div class="actions">
    <Button variant="filled" onclick={close}>Verstanden</Button>
  </div>
</dialog>

<style>
  /* 24px circle, 44px touch target through padding; negative margin keeps the line height. */
  .help {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 10px;
    margin: -10px 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    vertical-align: middle;
    -webkit-tap-highlight-color: transparent;
  }

  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 24px;
    height: 24px;
    border: 1.5px solid var(--md-sys-color-primary);
    border-radius: 50%;
    color: var(--md-sys-color-primary);
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1;
  }

  .help:hover .icon {
    background: var(--md-sys-color-secondary-container);
  }

  .help:focus-visible {
    outline: 3px solid var(--md-sys-color-primary);
    outline-offset: -4px;
    border-radius: 50%;
  }

  dialog {
    width: min(28rem, calc(100vw - 32px));
    padding: 24px;
    border: 0;
    border-radius: var(--radius-card);
    background: var(--md-sys-color-surface-container-high, var(--md-sys-color-surface));
    color: var(--md-sys-color-on-surface);
    font-size: 1rem;
    font-weight: 400;
    text-align: left;
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 0.5);
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 8px;
  }

  p + p {
    margin-top: 12px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 24px;
  }
</style>
